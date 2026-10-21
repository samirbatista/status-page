import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type AuditContext, recordAudit } from '@status-page/core';
import { type NotificationKind as DbKind, type Prisma } from '@status-page/db';
import {
  channelDestination,
  deliver,
  type EventPayload,
  eventLinks,
  NotifierError,
  pageBaseUrl,
  renderMessage,
  renderTestMessage,
  STRINGS,
  unknownVariables,
} from '@status-page/notifiers';
import {
  channelConfigSchemas,
  type channelCreateSchema,
  type channelUpdateSchema,
  LOCALES,
  type NotificationEventType,
  NOTIFICATION_EVENT_TYPES,
  type NotificationKind,
  type templateUpsertSchema,
} from '@status-page/shared';
import { type z } from 'zod';
import { NotifyService } from '../infra/notify.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SecretsService } from '../infra/secrets.service.js';
import { reason } from './provider-settings.service.js';

type CreateInput = z.infer<typeof channelCreateSchema>;
type UpdateInput = z.infer<typeof channelUpdateSchema>;

/** Campos da configuração que são segredo: não voltam para a tela, só "definido". */
const SECRET_FIELDS = ['webhookUrl', 'url', 'secret'] as const;

function maskUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/…`;
  } catch {
    return '…';
  }
}

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly notify: NotifyService,
  ) {}

  // --- Canais da equipe -------------------------------------------------------------

  private present(row: {
    id: string;
    kind: DbKind;
    name: string;
    enabled: boolean;
    events: string[];
    locale: string;
    configEnc: string;
    lastTestAt: Date | null;
    lastTestError: string | null;
    createdAt: Date;
  }) {
    const config = JSON.parse(this.secrets.decrypt(row.configEnc)) as Record<string, unknown>;
    const visible: Record<string, unknown> = { ...config };
    for (const field of SECRET_FIELDS) {
      if (typeof config[field] === 'string' && config[field]) {
        visible[field] = field === 'secret' ? '••••' : maskUrl(config[field] as string);
      }
    }
    const { configEnc: _omit, ...rest } = row;
    void _omit;
    return { ...rest, config: visible };
  }

  async list(pageId: string) {
    const rows = await this.prisma.client.notificationChannel.findMany({
      where: { pageId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.present(r));
  }

  private parseConfig(kind: NotificationKind, config: unknown) {
    const result = channelConfigSchemas[kind].safeParse(config);
    if (!result.success) {
      throw new BadRequestException({
        message: 'validation_failed',
        issues: result.error.issues.map((i) => ({
          path: ['config', ...i.path],
          message: i.message,
        })),
      });
    }
    return result.data as Record<string, unknown>;
  }

  async create(pageId: string, input: CreateInput, audit: AuditContext) {
    const config = this.parseConfig(input.kind, input.config);
    const row = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.notificationChannel.create({
        data: {
          pageId,
          kind: input.kind,
          name: input.name,
          enabled: input.enabled,
          events: input.events,
          locale: input.locale,
          configEnc: this.secrets.encrypt(JSON.stringify(config)),
        },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'notification_channel.create',
        entityType: 'notification_channel',
        entityId: created.id,
        pageId,
        after: { kind: input.kind, name: input.name, events: input.events },
      });
      return created;
    });
    return this.present(row);
  }

  /** Campos secretos em branco (ou com a máscara) mantêm o valor atual. */
  async update(pageId: string, channelId: string, input: UpdateInput, audit: AuditContext) {
    const before = await this.find(pageId, channelId);
    const stored = JSON.parse(this.secrets.decrypt(before.configEnc)) as Record<string, unknown>;
    const incoming = { ...input.config };
    for (const field of SECRET_FIELDS) {
      const value = incoming[field];
      if (
        value === undefined ||
        value === '' ||
        (typeof value === 'string' && value.includes('…')) ||
        value === '••••'
      ) {
        if (stored[field] !== undefined) incoming[field] = stored[field];
        else delete incoming[field];
      }
    }
    const config = this.parseConfig(before.kind, incoming);
    const row = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.notificationChannel.update({
        where: { id: channelId },
        data: {
          name: input.name,
          enabled: input.enabled,
          events: input.events,
          locale: input.locale,
          configEnc: this.secrets.encrypt(JSON.stringify(config)),
        },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'notification_channel.update',
        entityType: 'notification_channel',
        entityId: channelId,
        pageId,
        before: { name: before.name, enabled: before.enabled, events: before.events },
        after: { name: input.name, enabled: input.enabled, events: input.events },
      });
      return updated;
    });
    return this.present(row);
  }

  async remove(pageId: string, channelId: string, audit: AuditContext): Promise<void> {
    const before = await this.find(pageId, channelId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.notificationChannel.delete({ where: { id: channelId } });
      await recordAudit(tx, {
        ...audit,
        action: 'notification_channel.delete',
        entityType: 'notification_channel',
        entityId: channelId,
        pageId,
        before: { kind: before.kind, name: before.name },
      });
    });
  }

  /** "Enviar teste": envia na hora e guarda o resultado no canal. */
  async test(pageId: string, channelId: string) {
    const channel = await this.find(pageId, channelId);
    const page = await this.prisma.client.page.findUniqueOrThrow({ where: { id: pageId } });
    const pageUrl = await pageBaseUrl(this.prisma.client, page, this.notify.env.publicUrl);
    const config = JSON.parse(this.secrets.decrypt(channel.configEnc)) as Record<string, unknown>;
    const message = renderTestMessage(page, channel.locale, { pageUrl, itemUrl: pageUrl });
    let error: string | null = null;
    try {
      await deliver(
        channelDestination(channel.kind, config),
        message,
        await this.notify.providers(),
        { test: true, page: { id: page.id, name: page.name, slug: page.slug } },
      );
    } catch (e) {
      error = reason(e);
    }
    await this.prisma.client.notificationChannel.update({
      where: { id: channelId },
      data: { lastTestAt: new Date(), lastTestError: error },
    });
    return error ? { ok: false as const, error } : { ok: true as const };
  }

  private async find(pageId: string, channelId: string) {
    const channel = await this.prisma.client.notificationChannel.findFirst({
      where: { id: channelId, pageId },
    });
    if (!channel) throw new NotFoundException({ message: 'channel_not_found' });
    return channel;
  }

  // --- Templates ------------------------------------------------------------------

  /** Templates salvos e os textos padrão (para o editor mostrar o ponto de partida). */
  async templates(pageId: string) {
    const saved = await this.prisma.client.notificationTemplate.findMany({
      where: { pageId },
      orderBy: [{ event: 'asc' }, { locale: 'asc' }, { channel: 'asc' }],
    });
    const defaults = Object.fromEntries(
      LOCALES.map((locale) => [
        locale,
        Object.fromEntries(
          NOTIFICATION_EVENT_TYPES.map((event) => [
            event,
            {
              subject: STRINGS[locale].events[event].subject,
              body: STRINGS[locale].events[event].body,
            },
          ]),
        ),
      ]),
    );
    return { saved, defaults };
  }

  async upsertTemplate(
    pageId: string,
    input: z.infer<typeof templateUpsertSchema>,
    audit: AuditContext,
  ) {
    const unknown = unknownVariables(`${input.subject ?? ''} ${input.body}`);
    if (unknown.length > 0) {
      throw new BadRequestException({ message: 'unknown_variables', variables: unknown });
    }
    const key = { pageId, channel: input.channel, event: input.event, locale: input.locale };
    return this.prisma.client.$transaction(async (tx) => {
      const template = await tx.notificationTemplate.upsert({
        where: { pageId_channel_event_locale: key },
        create: { ...key, subject: input.subject, body: input.body },
        update: { subject: input.subject, body: input.body },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'notification_template.save',
        entityType: 'notification_template',
        entityId: template.id,
        pageId,
        after: input,
      });
      return template;
    });
  }

  async removeTemplate(pageId: string, templateId: string, audit: AuditContext) {
    const template = await this.prisma.client.notificationTemplate.findFirst({
      where: { id: templateId, pageId },
    });
    if (!template) throw new NotFoundException({ message: 'template_not_found' });
    await this.prisma.client.$transaction(async (tx) => {
      await tx.notificationTemplate.delete({ where: { id: templateId } });
      await recordAudit(tx, {
        ...audit,
        action: 'notification_template.delete',
        entityType: 'notification_template',
        entityId: templateId,
        pageId,
        before: template,
      });
    });
  }

  /** Pré-visualização com dados de exemplo. */
  async preview(pageId: string, input: z.infer<typeof templateUpsertSchema>) {
    const page = await this.prisma.client.page.findUniqueOrThrow({ where: { id: pageId } });
    const pageUrl = await pageBaseUrl(this.prisma.client, page, this.notify.env.publicUrl);
    const payload = samplePayload(page, input.event);
    const message = renderMessage(payload, {
      locale: input.locale,
      links: eventLinks(pageUrl, payload, 'exemplo'),
      template: { subject: input.subject, body: input.body },
    });
    return { subject: message.subject, text: message.text, unknown: unknownVariables(input.body) };
  }

  // --- Entregas ---------------------------------------------------------------------

  async deliveries(pageId: string, filter: { status?: string; cursor?: string; limit: number }) {
    const rows = await this.prisma.client.notificationDelivery.findMany({
      where: {
        pageId,
        ...(filter.status
          ? { status: filter.status as Prisma.EnumDeliveryStatusFilter['equals'] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: {
        event: { select: { type: true, payload: true, createdAt: true } },
        channel: { select: { name: true } },
      },
    });
    const hasMore = rows.length > filter.limit;
    const items = rows.slice(0, filter.limit).map(({ event, ...d }) => {
      const payload = event?.payload as EventPayload | undefined;
      return {
        ...d,
        recipient: d.channelId ? 'channel' : 'subscriber',
        event: event
          ? {
              type: event.type,
              title: payload?.incident?.title ?? payload?.maintenance?.title ?? '',
              createdAt: event.createdAt,
            }
          : null,
      };
    });
    return { items, nextCursor: hasMore ? items.at(-1)?.id : undefined };
  }

  async resend(pageId: string, deliveryId: string, audit: AuditContext) {
    const delivery = await this.prisma.client.notificationDelivery.findFirst({
      where: { id: deliveryId, pageId },
    });
    if (!delivery) throw new NotFoundException({ message: 'delivery_not_found' });
    await this.prisma.client.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'pending', lastError: null },
    });
    try {
      await this.notify.resend(deliveryId);
    } catch (error) {
      throw new BadRequestException({ message: 'queue_unavailable', reason: reason(error) });
    }
    await recordAudit(this.prisma.client, {
      ...audit,
      action: 'notification_delivery.resend',
      entityType: 'notification_delivery',
      entityId: deliveryId,
      pageId,
    });
  }
}

function samplePayload(
  page: { id: string; name: string; slug: string; timezone: string },
  event: NotificationEventType,
): EventPayload {
  const components = [
    { id: '00000000-0000-0000-0000-000000000001', name: 'API' },
    { id: '00000000-0000-0000-0000-000000000002', name: 'Painel' },
  ];
  const pageInfo = { id: page.id, name: page.name, slug: page.slug, timezone: page.timezone };
  if (event.startsWith('incident')) {
    return {
      type: event,
      page: pageInfo,
      incident: {
        id: '00000000-0000-0000-0000-00000000000a',
        title: 'Lentidão na API',
        status: event === 'incident_resolved' ? 'resolved' : 'investigating',
        impact: 'major',
      },
      update: { body: 'Estamos investigando o aumento do tempo de resposta.' },
      components,
    };
  }
  const start = new Date(Date.now() + 24 * 3_600_000);
  return {
    type: event,
    page: pageInfo,
    maintenance: {
      id: '00000000-0000-0000-0000-00000000000b',
      title: 'Atualização do banco de dados',
      status:
        event === 'maintenance_completed'
          ? 'completed'
          : event === 'maintenance_started'
            ? 'in_progress'
            : 'scheduled',
      scheduledStart: start.toISOString(),
      scheduledEnd: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
    },
    update: { body: 'Janela de manutenção planejada.' },
    components,
  };
}

export { NotifierError };
