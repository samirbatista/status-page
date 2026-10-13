import 'server-only';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API respondeu ${status}`);
  }

  get code(): string | undefined {
    const message = (this.body as { message?: unknown } | null)?.message;
    return typeof message === 'string' ? message : undefined;
  }
}

/**
 * Chamada à API a partir do servidor do Next. Repassa o cookie de sessão e o IP
 * do visitante (último valor do X-Forwarded-For, definido pelo Caddy), usado nas
 * regras de acesso por rede das páginas privadas.
 */
export async function serverApi<T>(path: string): Promise<T> {
  const [cookieStore, incoming] = await Promise.all([cookies(), headers()]);
  const cookieHeader = cookieStore.toString();
  const clientIp = incoming.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: {
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

/**
 * Para a página pública: 404 vira "não encontrada"; página privada sem sessão
 * leva ao login (voltando a `returnTo`); sem permissão ou fora da rede liberada
 * mostra a tela de acesso negado.
 */
export async function publicApi<T>(
  path: string,
  context: { locale: string; returnTo: string },
): Promise<T> {
  try {
    return await serverApi<T>(path);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) notFound();
      if (error.status === 401) {
        redirect(`/${context.locale}/admin/login?next=${encodeURIComponent(context.returnTo)}`);
      }
      if (error.status === 403) {
        const reason = error.code === 'ip_not_allowed' ? 'ip' : 'role';
        redirect(`/${context.locale}/denied?reason=${reason}`);
      }
    }
    throw error;
  }
}

/** Para o painel: sem sessão vai para o login; sem permissão vira 404. */
export async function adminApi<T>(path: string, locale: string): Promise<T> {
  try {
    return await serverApi<T>(path);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect(`/${locale}/admin/login`);
      if (error.status === 403 || error.status === 404) notFound();
    }
    throw error;
  }
}
