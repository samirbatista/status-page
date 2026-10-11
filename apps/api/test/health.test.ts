import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadApiEnv } from '../src/env.js';

const env = loadApiEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://status:status@localhost:5432/status',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  APP_SECRET: Buffer.alloc(32).toString('base64'),
});

describe('health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(env);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/healthz responde ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/readyz verifica banco e Redis', async () => {
    const res = await request(app.getHttpServer()).get('/api/readyz');
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
    expect(res.status).toBe(200);
  });
});

describe('health sem dependências', () => {
  it('GET /api/readyz responde 503 quando o banco está fora', async () => {
    const app = await createApp({
      ...env,
      DATABASE_URL: 'postgresql://status:status@127.0.0.1:1/status',
      REDIS_URL: 'redis://127.0.0.1:1',
    });
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
