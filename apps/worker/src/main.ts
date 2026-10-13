import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  baseEnvSchema,
  createLogger,
  databaseEnvSchema,
  loadEnv,
  redisEnvSchema,
} from '@status-page/config';
import { runDueMaintenanceTransitions } from '@status-page/core';
import { createPrismaClient } from '@status-page/db';
import { onShutdown, QUEUES, startHealthServer } from '@status-page/runtime';
import { purgeExpiredSessions } from './jobs.js';

const env = loadEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(redisEnvSchema.shape)
    .extend({ HEALTH_PORT: z.coerce.number().int().positive().default(3002) }),
);

const log = createLogger('worker', env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);
// BullMQ exige maxRetriesPerRequest: null nas conexões usadas por Workers.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => log.warn({ err: err.message }, 'falha na conexão com o Redis'));

const systemQueue = new Queue(QUEUES.system, { connection });
await systemQueue.upsertJobScheduler(
  'purge-expired-sessions',
  { pattern: '17 3 * * *' },
  { name: 'purge-expired-sessions' },
);
// Início e fim automáticos das manutenções programadas.
await systemQueue.upsertJobScheduler(
  'maintenance-transitions',
  { every: 60_000 },
  { name: 'maintenance-transitions' },
);

const worker = new Worker(
  QUEUES.system,
  async (job) => {
    switch (job.name) {
      case 'purge-expired-sessions': {
        const removed = await purgeExpiredSessions(prisma);
        log.info({ removed }, 'sessões expiradas removidas');
        return { removed };
      }
      case 'maintenance-transitions': {
        const result = await runDueMaintenanceTransitions(prisma);
        if (result.started.length || result.completed.length) {
          log.info(result, 'manutenções atualizadas automaticamente');
        }
        return result;
      }
      default:
        throw new Error(`job desconhecido: ${job.name}`);
    }
  },
  { connection },
);
worker.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job falhou'));

const health = await startHealthServer(env.HEALTH_PORT, async () => {
  await Promise.all([prisma.$queryRaw`SELECT 1`, connection.ping()]);
});
log.info({ port: env.HEALTH_PORT }, 'worker iniciado');

onShutdown(
  async () => {
    health.close();
    await worker.close();
    await systemQueue.close();
    await prisma.$disconnect();
    connection.disconnect();
  },
  (msg) => log.info(msg),
);
