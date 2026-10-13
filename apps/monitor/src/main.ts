/**
 * Serviço de monitoramento. Na F0 apenas sobe, valida a configuração e expõe
 * healthchecks; as checagens (HTTP, TCP, ICMP, DNS, SSL) chegam na F5.
 */
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  baseEnvSchema,
  createLogger,
  databaseEnvSchema,
  loadEnv,
  redisEnvSchema,
} from '@status-page/config';
import { createPrismaClient } from '@status-page/db';
import { onShutdown, startHealthServer } from '@status-page/runtime';

const env = loadEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(redisEnvSchema.shape)
    .extend({ HEALTH_PORT: z.coerce.number().int().positive().default(3003) }),
);

const log = createLogger('monitor', env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
redis.on('error', (err) => log.warn({ err: err.message }, 'falha na conexão com o Redis'));

const health = await startHealthServer(env.HEALTH_PORT, async () => {
  await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
});
log.info({ port: env.HEALTH_PORT }, 'monitor iniciado (checagens chegam na F5)');

onShutdown(
  async () => {
    health.close();
    await prisma.$disconnect();
    redis.disconnect();
  },
  (msg) => log.info(msg),
);
