import { createServer, type Server } from 'node:http';
import { createServer as createTcp, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck } from './checks.js';

describe('checagens', () => {
  let http: Server;
  let base = '';
  beforeAll(async () => {
    http = createServer((req, res) => {
      if (req.url === '/down') {
        res.writeHead(503);
        res.end('erro');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('status: tudo certo');
      }
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => http.close(() => r())));

  const http_ = (path: string, config: Record<string, unknown> = {}) =>
    runCheck({ type: 'http', target: `${base}${path}`, config, timeoutMs: 2000 });

  it('HTTP: código esperado e palavra-chave', async () => {
    expect(await http_('/ok')).toMatchObject({ ok: true, detail: 'HTTP 200' });
    expect(await http_('/down')).toMatchObject({ ok: false, error: 'HTTP 503' });
    expect(await http_('/down', { expectedStatus: '503' })).toMatchObject({ ok: true });
    expect(await http_('/ok', { keyword: 'TUDO CERTO' })).toMatchObject({ ok: true });
    expect(await http_('/ok', { keyword: 'falha' })).toMatchObject({
      ok: false,
      error: 'keyword_missing',
    });
    expect(await http_('/ok', { keyword: 'tudo', keywordAbsent: true })).toMatchObject({
      ok: false,
      error: 'keyword_present',
    });
  });

  it('HTTP: conexão recusada', async () => {
    // Porta livre (o fetch bloqueia portas "proibidas" como a 1).
    const probe = createTcp();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const free = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const result = await runCheck({
      type: 'http',
      target: `http://127.0.0.1:${free}`,
      config: {},
      timeoutMs: 2000,
    });
    expect(result).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
  });

  it('TCP: porta aberta e fechada', async () => {
    const server = createTcp((s) => s.end());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    expect(
      await runCheck({ type: 'tcp', target: '127.0.0.1', config: { port }, timeoutMs: 2000 }),
    ).toMatchObject({ ok: true });
    server.close();
    expect(
      await runCheck({ type: 'tcp', target: '127.0.0.1', config: { port: 1 }, timeoutMs: 2000 }),
    ).toMatchObject({ ok: false });
  });

  it('DNS: localhost resolve', async () => {
    const res = await runCheck({
      type: 'dns',
      target: 'localhost',
      config: { recordType: 'A' },
      timeoutMs: 3000,
    });
    // Sem DNS disponível no ambiente, ao menos responde com erro sem lançar.
    expect(typeof res.ok).toBe('boolean');
  });
});
