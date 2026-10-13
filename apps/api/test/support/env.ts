import { type ApiEnv, loadApiEnv } from '../../src/env.js';

/** Banco separado para os testes: a suíte apaga todos os dados a cada arquivo. */
export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgresql://status:status@localhost:5432/status_test';
}

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): ApiEnv {
  return loadApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: testDatabaseUrl(),
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    APP_SECRET: Buffer.alloc(32).toString('base64'),
    ...overrides,
  });
}
