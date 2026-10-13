/** Nomes das filas BullMQ compartilhadas entre API, worker e monitor. */
export const QUEUES = {
  /** Tarefas de manutenção do sistema (limpeza, agregações). */
  system: 'system',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
