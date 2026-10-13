'use client';

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> | null,
  ) {
    super(code);
  }
}

/** Chamada à API a partir do navegador (mesma origem, com o cabeçalho anti-CSRF). */
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'status-page',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = typeof body?.message === 'string' ? body.message : 'unknown';
    throw new ClientApiError(res.status, code, body);
  }
  return body as T;
}
