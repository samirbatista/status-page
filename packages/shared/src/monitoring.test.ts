import { describe, expect, it } from 'vitest';
import { globMatch, monitorInputSchema, statusMatcher } from './monitoring.js';

describe('monitoramento', () => {
  it('statusMatcher aceita faixas e listas', () => {
    const ok = statusMatcher('200-299, 301');
    expect([200, 204, 299, 301].every(ok)).toBe(true);
    expect([199, 300, 302, 500].some(ok)).toBe(false);
  });

  it('globMatch com curinga e sem caixa', () => {
    expect(globMatch('High*', 'HighLatency')).toBe(true);
    expect(globMatch('api-*-prod', 'API-gw-PROD')).toBe(true);
    expect(globMatch('a.b', 'axb')).toBe(false);
  });

  it('valida monitor por tipo', () => {
    const base = { name: 'API', intervalSeconds: 60 };
    expect(
      monitorInputSchema.safeParse({ ...base, type: 'http', target: 'https://api.test/health' })
        .success,
    ).toBe(true);
    expect(monitorInputSchema.safeParse({ ...base, type: 'http', target: 'ftp://x' }).success).toBe(
      false,
    );
    expect(
      monitorInputSchema.safeParse({ ...base, type: 'tcp', target: 'db.local', config: {} })
        .success,
    ).toBe(false);
    expect(
      monitorInputSchema.safeParse({
        ...base,
        type: 'tcp',
        target: 'db.local',
        config: { port: 5432 },
      }).success,
    ).toBe(true);
    expect(
      monitorInputSchema.safeParse({ ...base, type: 'icmp', target: 'x', intervalSeconds: 10 })
        .success,
    ).toBe(false);
  });
});
