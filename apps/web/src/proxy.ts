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
export default async function proxy(request: NextRequest) {
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

export const config = {
  // Ignora a API, o healthcheck, arquivos internos do Next e arquivos estáticos.
  matcher: '/((?!api|healthz|_next|_vercel|.*\\..*).*)',
};
