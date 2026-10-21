/**
 * Serviço de monitoramento: roda as checagens (HTTP, TCP, ICMP, DNS, SSL) dos
 * monitores no intervalo de cada um e aciona a automação de status quando o
 * serviço cai ou volta.
 */
import { Queue } from 'bullmq';
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
import { runDueChecks, SecretBox } from '@status-page/core';
import { createPrismaClient } from '@status-page/db';
import { enqueueFanout, onShutdown, QUEUES, startHealthServer } from '@status-page/runtime';

const env = loadEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(redisEnvSchema.shape)
    .extend(appSecretEnvSchema.shape)
    .extend({
      HEALTH_PORT: z.coerce.number().int().positive().default(3003),
      /** Checagens simultâneas. */
      MONITOR_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(20),
    }),
);

const log = createLogger('monitor', env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);
const secrets = new SecretBox(env.APP_SECRET);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
redis.on('error', (err) => log.warn({ err: err.message }, 'falha na conexão com o Redis'));
const notifications = new Queue(QUEUES.notifications, { connection: redis });

const TICK_MS = 5_000;
let running = true;
let lastTick = Date.now();

async function loop() {
  while (running) {
    const started = Date.now();
    lastTick = started;
    try {
      const { checked, transitions } = await runDueChecks(prisma, secrets, {
        concurrency: env.MONITOR_CONCURRENCY,
        onError: (id, err) =>
          log.error({ monitor: id, err: (err as Error).message }, 'falha ao checar monitor'),
      });
      for (const t of transitions) log.info(t, 'monitor mudou de estado');
      if (transitions.length > 0) {
        // Entrega imediata das notificações (o worker também varre os pendentes).
        const events = await prisma.notificationEvent.findMany({
          where: { fannedOutAt: null },
          select: { id: true },
        });
        await enqueueFanout(
          notifications,
          events.map((e) => e.id),
        ).catch((err) => log.warn({ err: err.message }, 'fila indisponível'));
      }
      if (checked > 0) log.debug({ checked }, 'checagens concluídas');
    } catch (error) {
      log.error({ err: (error as Error).message }, 'falha no ciclo de checagens');
    }
    await new Promise((r) => setTimeout(r, Math.max(0, TICK_MS - (Date.now() - started))));
  }
}
void loop();

const health = await startHealthServer(env.HEALTH_PORT, async () => {
  await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
  // Ciclo travado por mais de 2 minutos: o container deve ser reiniciado.
  if (Date.now() - lastTick > 120_000) throw new Error('ciclo de checagens parado');
});
log.info({ port: env.HEALTH_PORT }, 'monitor iniciado');

onShutdown(
  async () => {
    running = false;
    health.close();
    await notifications.close();
    await prisma.$disconnect();
    redis.disconnect();
  },
  (msg) => log.info(msg),
);
