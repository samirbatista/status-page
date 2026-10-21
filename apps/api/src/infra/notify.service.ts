import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { notifyEnv } from '@status-page/config';
import { type DeliveryContext, loadProviderSettings } from '@status-page/notifiers';
import { enqueueDelivery, enqueueFanout, QUEUES } from '@status-page/runtime';
import { API_ENV, type ApiEnv } from '../env.js';
import { PrismaService } from './prisma.service.js';
import { SecretsService } from './secrets.service.js';

/**
 * Ponte da API com as notificações: enfileira a distribuição dos eventos
 * (feita pelo worker) e oferece o contexto para envios diretos (testes de
 * canal e códigos de confirmação).
 */
@Injectable()
export class NotifyService implements OnModuleDestroy {
  private readonly log = new Logger(NotifyService.name);
  private readonly connection: Redis;
  readonly queue: Queue;
  readonly env: ReturnType<typeof notifyEnv>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    @Inject(API_ENV) apiEnv: ApiEnv,
  ) {
    this.env = notifyEnv(apiEnv);
    this.connection = new Redis(apiEnv.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.connection.on('error', () => undefined);
    this.queue = new Queue(QUEUES.notifications, { connection: this.connection });
    this.queue.on('error', () => undefined);
  }

  get context(): DeliveryContext {
    return { prisma: this.prisma.client, secrets: this.secrets, env: this.env };
  }

  providers() {
    return loadProviderSettings(this.prisma.client, this.secrets, this.env);
  }

  /**
   * Enfileira os eventos ainda não distribuídos. Falha da fila não derruba a
   * requisição: o worker varre os eventos pendentes a cada 30 s.
   */
  async flush(): Promise<void> {
    try {
      if (this.connection.status === 'wait') await this.connection.connect();
      const events = await this.prisma.client.notificationEvent.findMany({
        where: { fannedOutAt: null },
        select: { id: true },
        take: 100,
      });
      await enqueueFanout(
        this.queue,
        events.map((e) => e.id),
      );
    } catch (error) {
      this.log.warn({ err: (error as Error).message }, 'fila de notificações indisponível');
    }
  }

  async resend(deliveryId: string): Promise<void> {
    if (this.connection.status === 'wait') await this.connection.connect();
    await enqueueDelivery(this.queue, deliveryId, { resend: true });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
  }
}
