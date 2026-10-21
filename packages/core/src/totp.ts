import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) com HMAC-SHA1, 6 dígitos e passo de 30 s: o formato que
 * Google Authenticator, Microsoft Authenticator e Authy entendem.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Confere o código aceitando um passo de diferença para cada lado (relógios
 * levemente fora de sincronia). Retorna o passo aceito, ou `null`. Passos até
 * `lastStep` são recusados, para que um código não seja usado duas vezes.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { now?: number; lastStep?: number; window?: number } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(options.now);
  const window = options.window ?? 1;
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    // Compara todos os passos, sem sair cedo, para não vazar tempo.
    const ok = timingSafeEqual(Buffer.from(totpCode(secret, step)), given);
    if (ok && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (options.lastStep !== undefined && matched <= options.lastStep) return null;
  return matched;
}

/** URI `otpauth://` que os aplicativos leem pelo QR code. */
export function totpUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('base32 inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
