import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  appSecretEnvSchema,
  baseEnvSchema,
  createLogger,
  databaseEnvSchema,
  loadEnv,
  redisEnvSchema,
} from '@status-page/config';
import { runDueMaintenanceTransitions, SecretBox } from '@status-page/core';
import { createPrismaClient } from '@status-page/db';
import { onShutdown, QUEUES, startHealthServer } from '@status-page/runtime';
import { purgeExpiredSessions, syncAllLdapProviders } from './jobs.js';

const env = loadEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(redisEnvSchema.shape)
    .extend(appSecretEnvSchema.shape)
    .extend({
      HEALTH_PORT: z.coerce.number().int().positive().default(3002),
      /** Intervalo da sincronização com os diretórios LDAP (0 desliga). */
      LDAP_SYNC_MINUTES: z.coerce.number().int().min(0).max(1440).default(15),
    }),
);

const log = createLogger('worker', env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);
// BullMQ exige maxRetriesPerRequest: null nas conexões usadas por Workers.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => log.warn({ err: err.message }, 'falha na conexão com o Redis'));

const secrets = new SecretBox(env.APP_SECRET);
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

// Usuários desativados ou removidos do diretório perdem o acesso; grupos e papéis são atualizados.
if (env.LDAP_SYNC_MINUTES > 0) {
  await systemQueue.upsertJobScheduler(
    'ldap-sync',
    { every: env.LDAP_SYNC_MINUTES * 60_000 },
    { name: 'ldap-sync' },
  );
} else {
  await systemQueue.removeJobScheduler('ldap-sync');
}

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
      case 'ldap-sync': {
        const results = await syncAllLdapProviders(prisma, secrets);
        for (const r of results) {
          if (r.error) log.warn(r, 'sincronização LDAP interrompida');
          else if (r.disabled > 0) log.info(r, 'contas desativadas no diretório');
        }
        return results;
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
