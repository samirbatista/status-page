import { describe, expect, it } from 'vitest';
import { ipInCidrs, parseCidr } from './network.js';

describe('parseCidr', () => {
  it('aceita IPv4, IPv6 e IP isolado', () => {
    expect(parseCidr('10.0.0.0/8')).toEqual({ address: '10.0.0.0', prefix: 8, family: 'ipv4' });
    expect(parseCidr('2001:db8::/32')).toMatchObject({ prefix: 32, family: 'ipv6' });
    expect(parseCidr('192.168.1.10')).toMatchObject({ prefix: 32 });
  });

  it('recusa entradas inválidas', () => {
    for (const bad of ['10.0.0.0/33', '10.0.0/8', 'abc', '10.0.0.0/8/1', '10.0.0.0/x', '::/129']) {
      expect(parseCidr(bad)).toBeNull();
    }
  });
});

describe('ipInCidrs', () => {
  it('verifica pertencimento, inclusive IPv4 mapeado em IPv6', () => {
    const cidrs = ['10.0.0.0/8', '2001:db8::/32'];
    expect(ipInCidrs('10.1.2.3', cidrs)).toBe(true);
    expect(ipInCidrs('::ffff:10.1.2.3', cidrs)).toBe(true);
    expect(ipInCidrs('2001:db8::1', cidrs)).toBe(true);
    expect(ipInCidrs('11.0.0.1', cidrs)).toBe(false);
    expect(ipInCidrs(null, cidrs)).toBe(false);
    expect(ipInCidrs('10.1.2.3', [])).toBe(false);
  });
});
