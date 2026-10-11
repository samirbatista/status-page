import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startHealthServer } from './health-server.js';

describe('startHealthServer', () => {
  let server: Server | undefined;

  afterEach(
    () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  );

  async function get(path: string, ready: boolean) {
    server = await startHealthServer(0, async () => {
      if (!ready) throw new Error('fora');
    });
    const { port } = server.address() as AddressInfo;
    return fetch(`http://127.0.0.1:${port}${path}`);
  }

  it('healthz sempre ok', async () => {
    expect((await get('/healthz', false)).status).toBe(200);
  });

  it('readyz reflete a checagem', async () => {
    expect((await get('/readyz', true)).status).toBe(200);
    server?.close();
    expect((await get('/readyz', false)).status).toBe(503);
  });
});
