import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createHarness, type Harness } from './support/harness.js';
import { testEnv } from './support/env.js';

describe('health', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(() => h.close());

  it('GET /api/healthz responde ok sem sessão', async () => {
    const res = await h.anon.get('/api/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/readyz verifica banco e Redis', async () => {
    const res = await h.anon.get('/api/readyz');
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
    expect(res.status).toBe(200);
  });
});

describe('health sem dependências', () => {
  it('GET /api/readyz responde 503 quando banco e Redis estão fora', async () => {
    const app = await createApp(
      testEnv({
        DATABASE_URL: 'postgresql://status:status@127.0.0.1:1/status',
        REDIS_URL: 'redis://127.0.0.1:1',
      }),
    );
    await app.init();
    try {
      const res = await request(app.getHttpServer()).get('/api/readyz');
      expect(res.status).toBe(503);
      expect(res.body.checks).toEqual({ database: 'error', redis: 'error' });
    } finally {
      await app.close();
    }
  });
});
