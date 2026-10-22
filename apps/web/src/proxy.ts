import { LOCALES } from '@status-page/shared';
import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const CACHE_TTL_MS = 30_000;
const hostCache = new Map<string, { slug: string | null; expires: number }>();

/** Página associada ao domínio próprio (verificado), com cache curto em memória. */
async function slugForHost(host: string): Promise<string | null> {
  const key = host.toLowerCase();
  const cached = hostCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.slug;
  let slug: string | null = null;
  try {
    const res = await fetch(`${API_URL}/api/public/resolve-host?host=${encodeURIComponent(key)}`, {
      cache: 'no-store',
    });
    if (res.ok) slug = ((await res.json()) as { slug: string }).slug;
  } catch {
    // API fora do ar: segue como domínio principal.
  }
  if (hostCache.size > 1000) hostCache.clear();
  hostCache.set(key, { slug, expires: Date.now() + CACHE_TTL_MS });
  return slug;
}

const LOCALE_PREFIX = new RegExp(`^/(${LOCALES.join('|')})(?=/|$)`);
/** Caminhos que não pertencem à página: o painel e as rotas internas do site. */
const PASSTHROUGH = /^\/(?:p|admin|denied)(?:\/|$)/;

/**
 * Em um domínio próprio, `/`, `/history`, `/incidents/...` são reescritos para
 * `/p/<slug>/...`, mantendo o endereço que o visitante digitou. Depois o
 * next-intl trata o prefixo de idioma.
 */
async function route(request: NextRequest): Promise<NextResponse> {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const slug = host ? await slugForHost(host) : null;
  if (slug) {
    const { pathname } = request.nextUrl;
    const prefix = LOCALE_PREFIX.exec(pathname)?.[0] ?? '';
    const rest = pathname.slice(prefix.length) || '/';

    // O endereço canônico no domínio próprio não tem `/p/<slug>`: links internos
    // e o retorno do login (`/p/<slug>/...`) são redirecionados para o caminho limpo.
    const own = `/p/${slug}`;
    if (rest === own || rest.startsWith(`${own}/`)) {
      const clean = `${prefix}${rest.slice(own.length)}` || '/';
      const proto =
        request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
        request.nextUrl.protocol.replace(':', '');
      return NextResponse.redirect(
        new URL(`${clean}${request.nextUrl.search}`, `${proto}://${host}`),
      );
    }

    if (!PASSTHROUGH.test(rest)) {
      const url = request.nextUrl.clone();
      url.pathname = `${prefix}/p/${slug}${rest === '/' ? '' : rest}`;
      const response = intl(new NextRequest(url, request));
      if (response.headers.has('x-middleware-rewrite') || response.headers.has('location')) {
        return response;
      }
      // Com o idioma já no caminho, o next-intl só "deixa seguir" — o que voltaria
      // ao caminho original. Reescrevemos, mantendo os cabeçalhos que ele definiu.
      const rewrite = NextResponse.rewrite(url);
      response.headers.forEach((value, key) => {
        if (key !== 'x-middleware-next') rewrite.headers.set(key, value);
      });
      return rewrite;
    }
  }
  return intl(request);
}

/** Mini painel para outros sites: pode ser exibido em iframe de qualquer origem. */
// `/p/<slug>/embed` no domínio principal; `/embed` num domínio próprio (com ou sem idioma).
const EMBED = new RegExp(`^(?:/(?:${LOCALES.join('|')}))?(?:/p/[a-z0-9-]+)?/embed/?$`);

/**
 * Content-Security-Policy com nonce por requisição: só os scripts do próprio
 * Next (marcados com o nonce) executam. Estilos inline continuam liberados
 * (tema da página e bibliotecas de gráfico); imagens externas só por HTTPS
 * (HTML personalizado do tema).
 */
function contentSecurityPolicy(nonce: string, embed: boolean): string {
  const dev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // O editor de aparência pré-visualiza a página num iframe do próprio site.
    `frame-ancestors ${embed ? '*' : "'self'"}`,
  ].join('; ');
}

export default async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce, EMBED.test(request.nextUrl.pathname));
  // O Next lê o nonce do cabeçalho CSP da requisição e o aplica aos seus scripts.
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const response = await route(new NextRequest(request, { headers }));
  // Repassa os cabeçalhos novos para a renderização, somando-os aos que o
  // next-intl já repassa (ex.: o idioma detectado).
  const forward = NextResponse.next({ request: { headers } });
  const OVERRIDE = 'x-middleware-override-headers';
  const names = new Set(
    [response.headers.get(OVERRIDE), forward.headers.get(OVERRIDE)]
      .filter(Boolean)
      .flatMap((list) => list!.split(',')),
  );
  forward.headers.forEach((value, key) => {
    if (key.startsWith('x-middleware-request-') && !response.headers.has(key)) {
      response.headers.set(key, value);
    }
  });
  response.headers.set(OVERRIDE, [...names].join(','));
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Ignora a API, o healthcheck, arquivos internos do Next e arquivos estáticos.
  matcher: '/((?!api|healthz|_next|_vercel|.*\\..*).*)',
};
