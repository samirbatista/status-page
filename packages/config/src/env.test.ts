import { describe, expect, it } from 'vitest';
import { appSecretEnvSchema, baseEnvSchema, databaseEnvSchema, loadEnv } from './env.js';

describe('loadEnv', () => {
  it('aplica valores padrão', () => {
    expect(loadEnv(baseEnvSchema, {})).toEqual({ NODE_ENV: 'development', LOG_LEVEL: 'info' });
  });

  it('lista todas as variáveis inválidas', () => {
    const schema = databaseEnvSchema.extend(appSecretEnvSchema.shape);
    expect(() => loadEnv(schema, { DATABASE_URL: 'mysql://x', APP_SECRET: 'curta' })).toThrow(
      /DATABASE_URL[\s\S]*APP_SECRET/,
    );
  });

  it('aceita APP_SECRET de 32 bytes', () => {
    const secret = Buffer.alloc(32, 1).toString('base64');
    expect(loadEnv(appSecretEnvSchema, { APP_SECRET: secret })).toEqual({ APP_SECRET: secret });
  });
});
