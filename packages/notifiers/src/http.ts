import { NotifierError } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * POST com JSON e tempo limite. Sem seguir redirecionamentos (um 3xx poderia
 * levar a um endereço interno). 4xx é erro definitivo, exceto 408 e 429.
 */
export async function postJson(
  url: string,
  body: unknown,
  options: { headers?: Record<string, string>; timeoutMs?: number; rawBody?: string } = {},
): Promise<{ status: number; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.rawBody ?? JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network';
    const detail = error instanceof Error ? (error.cause as Error | undefined)?.message : undefined;
    throw new NotifierError(detail ? `${reason}: ${detail}` : reason, true);
  }
  const text = await res.text().catch(() => '');
  if (res.status >= 300) {
    const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
    throw new NotifierError(`HTTP ${res.status}: ${text.slice(0, 300)}`, retryable);
  }
  return { status: res.status, text };
}
