/** Rotinas executadas pelo worker: fila de notificações, limpeza, lembretes e bot do Telegram. */
import { createHash } from 'node:crypto';
import { recordMaintenanceEvent, type SecretBox } from '@status-page/core';
import { type PrismaClient } from '@status-page/db';
import { telegramCall, telegramSend } from './channels.js';
import { type DeliveryContext, fanOutEvent, processDelivery } from './dispatch.js';
import { loadProviderSettings, type NotifyEnv } from './settings.js';
import { enqueueDelivery, enqueueFanout, type JobQueue } from '@status-page/runtime';
import { maskTarget } from '@status-page/shared';

/** Inscrição pelo formulário sem confirmação é apagada depois deste prazo. */
export const PENDING_SUBSCRIBER_TTL_MS = 24 * 60 * 60 * 1000;
/** Lembrete de manutenção: quanto tempo antes do início. */
export const REMINDER_BEFORE_MS = 24 * 60 * 60 * 1000;

/** Eventos ainda não distribuídos (ex.: a fila estava fora do ar na hora). */
export async function sweepPendingEvents(
  prisma: PrismaClient,
  queue: JobQueue,
  now = new Date(),
): Promise<number> {
  const events = await prisma.notificationEvent.findMany({
    where: { fannedOutAt: null, createdAt: { lt: new Date(now.getTime() - 15_000) } },
    select: { id: true },
    take: 500,
  });
  await enqueueFanout(
    queue,
    events.map((e) => e.id),
  );
  return events.length;
}

/** Job `fanout`: cria as entregas e enfileira cada uma. */
export async function runFanout(
  prisma: PrismaClient,
  queue: JobQueue,
  eventId: string,
): Promise<number> {
  const ids = await fanOutEvent(prisma, eventId);
  for (const id of ids) await enqueueDelivery(queue, id);
  return ids.length;
}

/**
 * Job `deliver`. Uma falha temporária lança erro para o BullMQ tentar de novo
 * (backoff exponencial); na última tentativa, a entrega fica como `failed`.
 */
export async function runDelivery(
  ctx: DeliveryContext,
  deliveryId: string,
  attempt: { made: number; max: number },
) {
  const outcome = await processDelivery(ctx, deliveryId, {
    finalAttempt: attempt.made + 1 >= attempt.max,
  });
  if (outcome.status === 'retry') throw new Error(outcome.error);
  return outcome;
}

/**
 * Remove inscrições nunca confirmadas: as do formulário depois de 24 h e as
 * importadas quando o convite expira. Também apaga códigos antigos.
 */
export async function cleanupSubscribers(prisma: PrismaClient, now = new Date()) {
  const { count } = await prisma.subscriber.deleteMany({
    where: {
      status: 'pending',
      OR: [
        { source: 'form', createdAt: { lt: new Date(now.getTime() - PENDING_SUBSCRIBER_TTL_MS) } },
        { source: 'import', linkExpiresAt: { lt: now } },
      ],
    },
  });
  await prisma.verificationCode.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - PENDING_SUBSCRIBER_TTL_MS) } },
  });
  return count;
}

/**
 * Lembrete 24 h antes das manutenções agendadas com antecedência (criadas
 * mais de 24 h antes do início). Cada manutenção é lembrada uma vez.
 */
export async function maintenanceReminders(prisma: PrismaClient, now = new Date()) {
  const due = await prisma.maintenance.findMany({
    where: {
      status: 'scheduled',
      reminderSentAt: null,
      scheduledStart: { gt: now, lte: new Date(now.getTime() + REMINDER_BEFORE_MS) },
    },
    select: { id: true, createdAt: true, scheduledStart: true },
  });
  const sent: string[] = [];
  for (const m of due) {
    if (m.scheduledStart.getTime() - m.createdAt.getTime() < REMINDER_BEFORE_MS) {
      // Agendada em cima da hora: o aviso de agendamento já cumpre o papel.
      await prisma.maintenance.update({ where: { id: m.id }, data: { reminderSentAt: now } });
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.maintenance.updateMany({
        where: { id: m.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 1) {
        await recordMaintenanceEvent(tx, m.id, 'maintenance_reminder');
        sent.push(m.id);
      }
    });
  }
  return sent;
}

// --- Bot do Telegram ---------------------------------------------------------------

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number; type: string }; text?: string };
}

const START_REPLY = {
  ok: {
    'pt-BR': 'Pronto! Você vai receber aqui as notificações de {page}. Para cancelar, envie /stop.',
    'en-US': 'Done! You will get {page} notifications here. To unsubscribe, send /stop.',
    es: '¡Listo! Recibirá aquí las notificaciones de {page}. Para cancelar, envíe /stop.',
  },
  invalid:
    'Link inválido ou expirado. Faça a inscrição de novo na página de status. / Invalid or expired link.',
  stopped: 'Inscrição cancelada. / Unsubscribed.',
} as const;

/**
 * Trata uma mensagem recebida pelo bot: `/start <token>` vincula o chat à
 * inscrição pendente (e a ativa); `/stop` cancela as inscrições deste chat.
 */
export async function handleTelegramUpdate(
  prisma: PrismaClient,
  secrets: SecretBox,
  update: TelegramUpdate,
): Promise<string | null> {
  const text = update.message?.text?.trim() ?? '';
  const chatId = update.message ? String(update.message.chat.id) : null;
  if (!chatId) return null;

  if (text === '/stop') {
    const targetHash = secrets.mac(`telegram:${chatId}`);
    const subs = await prisma.subscriber.findMany({
      where: { kind: 'telegram', targetHash, status: 'active' },
    });
    for (const sub of subs) {
      await prisma.$transaction([
        prisma.subscriber.update({
          where: { id: sub.id },
          data: { status: 'unsubscribed', unsubscribedAt: new Date() },
        }),
        prisma.consentRecord.create({
          data: {
            pageId: sub.pageId,
            subscriberId: sub.id,
            targetHash,
            action: 'unsubscribe',
            text: 'telegram:/stop',
          },
        }),
      ]);
    }
    return START_REPLY.stopped;
  }

  const match = /^\/start\s+([\w-]{16,128})$/.exec(text);
  if (!match) return null;
  const sub = await prisma.subscriber.findFirst({
    where: {
      kind: 'telegram',
      status: 'pending',
      linkTokenHash: hashToken(match[1]!),
      linkExpiresAt: { gt: new Date() },
    },
    include: { page: { select: { name: true } } },
  });
  if (!sub) return START_REPLY.invalid;

  const targetHash = secrets.mac(`telegram:${chatId}`);
  // O mesmo chat já assinava esta página: mantém a inscrição existente atualizada.
  const existing = await prisma.subscriber.findFirst({
    where: { pageId: sub.pageId, kind: 'telegram', targetHash, id: { not: sub.id } },
  });
  await prisma.$transaction(async (tx) => {
    if (existing) await tx.subscriber.delete({ where: { id: existing.id } });
    await tx.subscriber.update({
      where: { id: sub.id },
      data: {
        targetEnc: secrets.encrypt(chatId),
        targetHash,
        targetDisplay: maskTarget('telegram', chatId),
        status: 'active',
        confirmedAt: new Date(),
        // O token continua valendo para a tela consultar o estado; o vínculo não se repete.
        linkExpiresAt: null,
      },
    });
    await tx.consentRecord.create({
      data: {
        pageId: sub.pageId,
        subscriberId: sub.id,
        targetHash,
        action: 'confirm',
        text: 'telegram:/start',
      },
    });
  });
  const locale = sub.locale as keyof typeof START_REPLY.ok;
  return (START_REPLY.ok[locale] ?? START_REPLY.ok['pt-BR']).replace('{page}', sub.page.name);
}

/**
 * Lê as mensagens do bot por long polling (`getUpdates`): funciona em rede
 * interna, sem URL pública para webhook. Para quando `signal` é abortado.
 */
export async function pollTelegram(
  prisma: PrismaClient,
  secrets: SecretBox,
  env: Pick<NotifyEnv, 'telegramApiUrl'>,
  state: { get(): Promise<number>; set(offset: number): Promise<void> },
  signal: AbortSignal,
  log: (msg: string, data?: object) => void,
): Promise<void> {
  while (!signal.aborted) {
    const settings = await loadProviderSettings(prisma, secrets, env).catch(() => null);
    if (!settings?.telegram) {
      await sleep(30_000, signal);
      continue;
    }
    try {
      const offset = await state.get();
      const updates = (await telegramCall(settings.telegram, 'getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message'],
      })) as TelegramUpdate[];
      for (const update of updates) {
        const reply = await handleTelegramUpdate(prisma, secrets, update);
        if (reply && update.message) {
          await telegramSend(settings.telegram, String(update.message.chat.id), reply).catch(
            () => undefined,
          );
        }
        await state.set(update.update_id + 1);
      }
    } catch (error) {
      log('falha ao ler mensagens do Telegram', { err: (error as Error).message });
      await sleep(15_000, signal);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
