import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  appSecretEnvSchema,
  baseEnvSchema,
  createLogger,
  databaseEnvSchema,
  loadEnv,
  notifyEnv,
  notifyEnvSchema,
  redisEnvSchema,
} from '@status-page/config';
import { runDueMaintenanceTransitions, SecretBox } from '@status-page/core';
import { createPrismaClient } from '@status-page/db';
import { onShutdown, QUEUES, startHealthServer } from '@status-page/runtime';
import { purgeExpiredSessions, syncAllLdapProviders } from './jobs.js';
import {
  cleanupSubscribers,
  maintenanceReminders,
  pollTelegram,
  runDelivery,
  runFanout,
  sweepPendingEvents,
} from '@status-page/notifiers';

const env = loadEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(redisEnvSchema.shape)
    .extend(appSecretEnvSchema.shape)
    .extend(notifyEnvSchema.shape)
    .extend({
      HEALTH_PORT: z.coerce.number().int().positive().default(3002),
      /** Intervalo da sincronização com os diretórios LDAP (0 desliga). */
      LDAP_SYNC_MINUTES: z.coerce.number().int().min(0).max(1440).default(15),
      /** Envios por segundo, somando todos os canais. */
      NOTIFY_RATE_PER_SECOND: z.coerce.number().int().min(1).max(1000).default(20),
    }),
);

const log = createLogger('worker', env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);
// BullMQ exige maxRetriesPerRequest: null nas conexões usadas por Workers.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => log.warn({ err: err.message }, 'falha na conexão com o Redis'));

const secrets = new SecretBox(env.APP_SECRET);
const notifyContext = { prisma, secrets, env: notifyEnv(env) };
const systemQueue = new Queue(QUEUES.system, { connection });
const notificationsQueue = new Queue(QUEUES.notifications, { connection });
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

// Notificações: eventos esquecidos (fila fora do ar), lembretes e limpeza de inscrições.
await systemQueue.upsertJobScheduler(
  'notification-sweep',
  { every: 30_000 },
  { name: 'notification-sweep' },
);
await systemQueue.upsertJobScheduler(
  'maintenance-reminders',
  { every: 5 * 60_000 },
  { name: 'maintenance-reminders' },
);
await systemQueue.upsertJobScheduler(
  'subscriber-cleanup',
  { every: 60 * 60_000 },
  { name: 'subscriber-cleanup' },
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
      case 'ldap-sync': {
        const results = await syncAllLdapProviders(prisma, secrets);
        for (const r of results) {
          if (r.error) log.warn(r, 'sincronização LDAP interrompida');
          else if (r.disabled > 0) log.info(r, 'contas desativadas no diretório');
        }
        return results;
      }
      case 'notification-sweep':
        return { enqueued: await sweepPendingEvents(prisma, notificationsQueue) };
      case 'maintenance-reminders': {
        const sent = await maintenanceReminders(prisma);
        if (sent.length)
          await sweepPendingEvents(prisma, notificationsQueue, new Date(Date.now() + 60_000));
        return { sent };
      }
      case 'subscriber-cleanup': {
        const removed = await cleanupSubscribers(prisma);
        if (removed) log.info({ removed }, 'inscrições não confirmadas removidas');
        return { removed };
      }
      default:
        throw new Error(`job desconhecido: ${job.name}`);
    }
  },
  { connection },
);
worker.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job falhou'));

const notifier = new Worker(
  QUEUES.notifications,
  async (job) => {
    switch (job.name) {
      case 'fanout':
        return { deliveries: await runFanout(prisma, notificationsQueue, job.data.eventId) };
      case 'deliver':
        return runDelivery(notifyContext, job.data.deliveryId, {
          made: job.attemptsMade,
          max: job.opts.attempts ?? 1,
        });
      default:
        throw new Error(`job desconhecido: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 10,
    limiter: { max: env.NOTIFY_RATE_PER_SECOND, duration: 1000 },
  },
);
notifier.on('failed', (job, err) =>
  log.warn({ job: job?.name, attempt: job?.attemptsMade, err: err.message }, 'envio falhou'),
);

// Bot do Telegram: vínculo das inscrições (/start) e cancelamento (/stop).
const telegramAbort = new AbortController();
const telegramOffsetKey = 'notify:telegram:offset';
void pollTelegram(
  prisma,
  secrets,
  notifyEnv(env),
  {
    get: async () => Number((await connection.get(telegramOffsetKey)) ?? 0),
    set: async (offset) => void (await connection.set(telegramOffsetKey, String(offset))),
  },
  telegramAbort.signal,
  (msg, data) => log.warn(data ?? {}, msg),
);

const health = await startHealthServer(env.HEALTH_PORT, async () => {
  await Promise.all([prisma.$queryRaw`SELECT 1`, connection.ping()]);
});
log.info({ port: env.HEALTH_PORT }, 'worker iniciado');

onShutdown(
  async () => {
    health.close();
    telegramAbort.abort();
    await worker.close();
    await notifier.close();
    await systemQueue.close();
    await notificationsQueue.close();
    await prisma.$disconnect();
    connection.disconnect();
  },
  (msg) => log.info(msg),
);
