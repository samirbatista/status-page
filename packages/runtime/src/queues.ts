/** Nomes das filas BullMQ compartilhadas entre API, worker e monitor. */
export const QUEUES = {
  /** Tarefas de manutenção do sistema (limpeza, agregações). */
  system: 'system',
  /** Distribuição de eventos (fan-out) e envio das notificações. */
  notifications: 'notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Tentativas de cada entrega: 30 s, 1, 2, 4, 8 e 16 min entre elas (backoff exponencial). */
export const DELIVERY_ATTEMPTS = 7;
export const DELIVERY_BACKOFF_MS = 30_000;

/** Jobs da fila de notificações. */
export interface NotificationJobs {
  fanout: { eventId: string };
  deliver: { deliveryId: string };
}

/** Fila mínima (o tipo `Queue` do BullMQ satisfaz). */
export interface JobQueue {
  add(
    name: string,
    data: unknown,
    opts?: {
      jobId?: string;
      attempts?: number;
      backoff?: { type: 'exponential'; delay: number };
      removeOnComplete?: number | boolean;
      removeOnFail?: number | boolean;
    },
  ): Promise<unknown>;
}

const KEEP = { removeOnComplete: 1000, removeOnFail: 5000 };

export async function enqueueFanout(queue: JobQueue, eventIds: string[]): Promise<void> {
  for (const eventId of eventIds) {
    // O jobId evita distribuir o mesmo evento duas vezes enquanto o job existir.
    await queue.add(
      'fanout',
      { eventId },
      {
        jobId: `fanout-${eventId}`,
        attempts: 5,
        ...KEEP,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    );
  }
}

export async function enqueueDelivery(
  queue: JobQueue,
  deliveryId: string,
  options: { resend?: boolean } = {},
): Promise<void> {
  await queue.add(
    'deliver',
    { deliveryId },
    {
      // Reenvio manual ganha outro jobId; o automático não duplica.
      jobId: options.resend ? `deliver-${deliveryId}-${Date.now()}` : `deliver-${deliveryId}`,
      attempts: DELIVERY_ATTEMPTS,
      backoff: { type: 'exponential', delay: DELIVERY_BACKOFF_MS },
      ...KEEP,
    },
  );
}
