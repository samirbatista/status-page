import { type SecretBox } from '@status-page/core';
import { type Prisma, type PrismaClient } from '@status-page/db';
import {
  eventCategory,
  type NotificationEventType,
  type NotificationKind,
  WEBHOOK_SUBSCRIBER_KINDS,
} from '@status-page/shared';
import { deliver } from './channels.js';
import { renderMessage } from './render.js';
import { loadProviderSettings, type NotifyEnv } from './settings.js';
import { type Destination, type EventPayload, type MessageLinks, NotifierError } from './types.js';
import { assertSubscriberWebhook, type WebhookSubscriberKind } from './url-guard.js';

// --- Links ---------------------------------------------------------------------------

/**
 * Endereço público da página: o primeiro domínio próprio verificado ou
 * `<PUBLIC_URL>/p/<slug>`. O protocolo segue o do PUBLIC_URL.
 */
export async function pageBaseUrl(
  db: Pick<PrismaClient, 'pageDomain'>,
  page: { id: string; slug: string },
  publicUrl: string,
): Promise<string> {
  const base = new URL(publicUrl);
  const domain = await db.pageDomain.findFirst({
    where: { pageId: page.id, verifiedAt: { not: null } },
    orderBy: { createdAt: 'asc' },
  });
  if (domain) return `${base.protocol}//${domain.hostname}`;
  return `${base.origin}${base.pathname.replace(/\/$/, '')}/p/${page.slug}`;
}

export function eventLinks(
  pageUrl: string,
  payload: EventPayload,
  manageToken?: string,
): MessageLinks {
  const itemUrl = payload.incident
    ? `${pageUrl}/incidents/${payload.incident.id}`
    : payload.maintenance
      ? `${pageUrl}/maintenances/${payload.maintenance.id}`
      : pageUrl;
  return {
    pageUrl,
    itemUrl,
    ...(manageToken
      ? {
          manageUrl: `${pageUrl}/subscription/${manageToken}`,
          unsubscribeUrl: `${pageUrl}/subscription/${manageToken}?action=unsubscribe`,
        }
      : {}),
  };
}

// --- Destinos --------------------------------------------------------------------------

/** Destino de um canal da equipe a partir da configuração (já decifrada). */
export function channelDestination(
  kind: NotificationKind,
  config: Record<string, unknown>,
): Destination {
  switch (kind) {
    case 'email':
      return { kind, recipients: config.recipients as string[] };
    case 'telegram':
      return { kind, chatId: String(config.chatId) };
    case 'whatsapp':
      return { kind, phones: config.phones as string[] };
    case 'webhook':
      return {
        kind,
        url: String(config.url),
        secret: (config.secret as string | undefined) || undefined,
      };
    default:
      return { kind, webhookUrl: String(config.webhookUrl) };
  }
}

/** Destino de um assinante a partir do contato (já decifrado). */
export function subscriberDestination(kind: NotificationKind, target: string): Destination {
  switch (kind) {
    case 'email':
      return { kind, recipients: [target] };
    case 'telegram':
      return { kind, chatId: target };
    case 'whatsapp':
      return { kind, phones: [target] };
    case 'webhook':
      return { kind, url: target };
    default:
      return { kind, webhookUrl: target };
  }
}

// --- Fan-out -----------------------------------------------------------------------------

/**
 * Cria as entregas de um evento: canais da equipe habilitados para a categoria
 * (ou para o tipo específico do evento)
 * e assinantes **ativos** (confirmados) interessados na categoria e nos
 * componentes. Idempotente: um evento já distribuído não gera novas entregas.
 */
export async function fanOutEvent(prisma: PrismaClient, eventId: string): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    // Trava a linha: dois workers não distribuem o mesmo evento.
    const claimed = await tx.notificationEvent.updateMany({
      where: { id: eventId, fannedOutAt: null },
      data: { fannedOutAt: new Date() },
    });
    if (claimed.count === 0) return [];
    const event = await tx.notificationEvent.findUniqueOrThrow({ where: { id: eventId } });
    const category = eventCategory(event.type as NotificationEventType);

    const channels = await tx.notificationChannel.findMany({
      where: { pageId: event.pageId, enabled: true, events: { hasSome: [category, event.type] } },
      select: { id: true, kind: true, name: true },
    });
    const componentFilter: Prisma.SubscriberWhereInput =
      event.componentIds.length === 0
        ? {}
        : {
            OR: [
              { allComponents: true },
              { components: { some: { componentId: { in: event.componentIds } } } },
            ],
          };
    const subscribers = await tx.subscriber.findMany({
      where: {
        pageId: event.pageId,
        status: 'active',
        eventTypes: { has: category },
        ...componentFilter,
      },
      select: { id: true, kind: true, targetDisplay: true },
    });

    await tx.notificationDelivery.createMany({
      data: [
        ...channels.map((c) => ({
          pageId: event.pageId,
          eventId,
          channelId: c.id,
          kind: c.kind,
          target: c.name,
        })),
        ...subscribers.map((s) => ({
          pageId: event.pageId,
          eventId,
          subscriberId: s.id,
          kind: s.kind,
          target: s.targetDisplay ?? '—',
        })),
      ],
      skipDuplicates: true,
    });
    const deliveries = await tx.notificationDelivery.findMany({
      where: { eventId, status: 'pending' },
      select: { id: true },
    });
    return deliveries.map((d) => d.id);
  });
}

// --- Entrega -----------------------------------------------------------------------------

export type DeliveryOutcome =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }
  /** Falha temporária: o chamador deve tentar de novo mais tarde. */
  | { status: 'retry'; error: string };

export interface DeliveryContext {
  prisma: PrismaClient;
  secrets: SecretBox;
  env: NotifyEnv;
}

/** Template personalizado: o do tipo de canal vence o de "todos os canais". */
async function findTemplate(
  prisma: PrismaClient,
  pageId: string,
  kind: NotificationKind,
  event: NotificationEventType,
  locale: string,
) {
  const templates = await prisma.notificationTemplate.findMany({
    where: { pageId, event, locale, channel: { in: [kind, 'all'] } },
  });
  return templates.find((t) => t.channel === kind) ?? templates[0] ?? null;
}

/**
 * Envia uma entrega e registra o resultado. `finalAttempt` indica a última
 * tentativa: uma falha temporária vira `failed` em vez de `retry`.
 */
export async function processDelivery(
  ctx: DeliveryContext,
  deliveryId: string,
  options: { finalAttempt?: boolean } = {},
): Promise<DeliveryOutcome> {
  const { prisma, secrets, env } = ctx;
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { event: true, channel: true, subscriber: true },
  });
  if (!delivery || delivery.status === 'sent') return { status: 'sent' };
  const finish = async (outcome: DeliveryOutcome): Promise<DeliveryOutcome> => {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: { increment: outcome.status === 'skipped' ? 0 : 1 },
        status:
          outcome.status === 'retry'
            ? 'pending'
            : outcome.status === 'skipped'
              ? 'skipped'
              : outcome.status,
        lastError:
          outcome.status === 'failed' || outcome.status === 'retry'
            ? outcome.error.slice(0, 500)
            : outcome.status === 'skipped'
              ? outcome.reason
              : null,
        ...(outcome.status === 'sent' ? { sentAt: new Date() } : {}),
      },
    });
    return outcome;
  };

  if (!delivery.event) return finish({ status: 'skipped', reason: 'event_deleted' });
  const payload = delivery.event.payload as unknown as EventPayload;
  const page = await prisma.page.findUnique({ where: { id: delivery.pageId } });
  if (!page) return finish({ status: 'skipped', reason: 'page_deleted' });
  const pageUrl = await pageBaseUrl(prisma, page, env.publicUrl);

  let destination: Destination;
  let locale: string;
  let manageToken: string | undefined;
  if (delivery.channel) {
    if (!delivery.channel.enabled) return finish({ status: 'skipped', reason: 'channel_disabled' });
    const config = JSON.parse(secrets.decrypt(delivery.channel.configEnc)) as Record<
      string,
      unknown
    >;
    destination = channelDestination(delivery.channel.kind, config);
    locale = delivery.channel.locale;
  } else if (delivery.subscriber) {
    const sub = delivery.subscriber;
    // Só assinante confirmado recebe: sem código validado, nada é enviado.
    if (sub.status !== 'active' || !sub.targetEnc) {
      return finish({ status: 'skipped', reason: 'subscriber_inactive' });
    }
    const target = secrets.decrypt(sub.targetEnc);
    if ((WEBHOOK_SUBSCRIBER_KINDS as readonly string[]).includes(sub.kind)) {
      try {
        await assertSubscriberWebhook(sub.kind as WebhookSubscriberKind, target, {
          extraHosts: env.webhookExtraHosts,
        });
      } catch (error) {
        const err = error as NotifierError;
        return finish(
          err.retryable && !options.finalAttempt
            ? { status: 'retry', error: err.message }
            : { status: 'failed', error: err.message },
        );
      }
    }
    destination = subscriberDestination(sub.kind, target);
    locale = sub.locale;
    manageToken = secrets.decrypt(sub.manageTokenEnc);
  } else {
    return finish({ status: 'skipped', reason: 'recipient_deleted' });
  }

  const template = await findTemplate(prisma, delivery.pageId, delivery.kind, payload.type, locale);
  const message = renderMessage(payload, {
    locale,
    links: eventLinks(pageUrl, payload, manageToken),
    template,
  });
  const settings = await loadProviderSettings(prisma, secrets, env);
  try {
    await deliver(destination, message, settings, payload);
    return finish({ status: 'sent' });
  } catch (error) {
    const err = error instanceof NotifierError ? error : new NotifierError(String(error), true);
    return finish(
      err.retryable && !options.finalAttempt
        ? { status: 'retry', error: err.message }
        : { status: 'failed', error: err.message },
    );
  }
}
