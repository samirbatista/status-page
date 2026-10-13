import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API respondeu ${status}`);
  }
}

/** Chamada à API a partir do servidor do Next, repassando o cookie de sessão. */
export async function serverApi<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

/** Como `serverApi`, mas traduz 404 em página não encontrada. */
export async function publicApi<T>(path: string): Promise<T> {
  try {
    return await serverApi<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
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
