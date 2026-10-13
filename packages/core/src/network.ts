import { BlockList, isIP } from 'node:net';

export interface Cidr {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

/** Interpreta `10.0.0.0/8`, `2001:db8::/32` ou um IP isolado (equivale a /32 ou /128). */
export function parseCidr(value: string): Cidr | null {
  const [address = '', prefixText, ...rest] = value.trim().split('/');
  if (rest.length > 0) return null;
  const version = isIP(address);
  if (version === 0) return null;
  const max = version === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? max : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max || (prefixText ?? '').match(/\D/)) {
    return null;
  }
  return { address, prefix, family: version === 4 ? 'ipv4' : 'ipv6' };
}

/** Converte `::ffff:1.2.3.4` (IPv4 mapeado em IPv6) para `1.2.3.4`. */
export function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped ? mapped[1]! : ip;
}

/** Verdadeiro se o IP pertence a alguma das redes. CIDRs inválidos são ignorados. */
export function ipInCidrs(ip: string | null | undefined, cidrs: string[]): boolean {
  if (!ip || cidrs.length === 0) return false;
  const address = normalizeIp(ip);
  const version = isIP(address);
  if (version === 0) return false;
  const list = new BlockList();
  for (const value of cidrs) {
    const cidr = parseCidr(value);
    if (cidr) list.addSubnet(cidr.address, cidr.prefix, cidr.family);
  }
  return list.check(address, version === 4 ? 'ipv4' : 'ipv6');
}
