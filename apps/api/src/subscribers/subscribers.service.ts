import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type AuditContext, recordAudit } from '@status-page/core';
import { type Page, type Prisma, type Subscriber } from '@status-page/db';
import {
  assertSubscriberWebhook,
  deliver,
  pageBaseUrl,
  renderTestMessage,
  sendEmail,
  subscriberDestination,
  verificationTexts,
  type WebhookSubscriberKind,
  whatsappCode,
} from '@status-page/notifiers';
import {
  CONSENT_VERSION,
  isLocale,
  maskTarget,
  normalizeTarget,
  type NotificationKind,
  type SubscribeInput,
  type SubscriberKind,
  WEBHOOK_SUBSCRIBER_KINDS,
} from '@status-page/shared';
import { assertCanView } from '../access/page-access.js';
import { type AuthContext } from '../common/auth.types.js';
import { parseCsv, toCsv } from '../common/csv.js';
import { RateLimitService, tooManyRequests } from '../common/rate-limit.service.js';
import { NotifyService } from '../infra/notify.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SecretsService } from '../infra/secrets.service.js';

/** Código: 6 dígitos, 15 minutos, 5 tentativas; reenvio após 60 s, até 5 por hora. */
export const CODE_TTL_MS = 15 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_AFTER_MS = 60_000;
export const CODE_SENDS_PER_HOUR = 5;
/** Vínculo do Telegram e convite de importação. */
const TELEGRAM_LINK_TTL_MS = 60 * 60_000;
const INVITE_TTL_MS = 7 * 24 * 3_600_000;
const IMPORT_MAX_ROWS = 1000;

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isWebhookKind(kind: string): kind is WebhookSubscriberKind {
  return (WEBHOOK_SUBSCRIBER_KINDS as readonly string[]).includes(kind);
}

@Injectable()
export class SubscribersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly notify: NotifyService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private targetHash(kind: NotificationKind, target: string): string {
    return this.secrets.mac(`${kind}:${normalizeTarget(kind, target)}`);
  }

  private async consent(
    db: Prisma.TransactionClient | PrismaService['client'],
    sub: { id: string; pageId: string; targetHash: string | null },
    action: string,
    meta: Meta,
    text: string,
  ) {
    await db.consentRecord.create({
      data: {
        pageId: sub.pageId,
        subscriberId: sub.id,
        targetHash: sub.targetHash,
        action,
        text,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
      },
    });
  }

  // --- Página pública ------------------------------------------------------------------

  private async viewablePage(
    slug: string,
    auth: AuthContext | undefined,
    ip: string | null | undefined,
  ) {
    const page = await this.prisma.client.page.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException({ message: 'page_not_found' });
    assertCanView(page, auth, ip);
    return page;
  }

  /** Canais disponíveis (conforme os provedores configurados) e componentes. */
  async options(slug: string, auth: AuthContext | undefined, ip: string | null | undefined) {
    const page = await this.viewablePage(slug, auth, ip);
    const providers = await this.notify.providers();
    const kinds: SubscriberKind[] = [
      ...(providers.smtp ? (['email'] as const) : []),
      ...(providers.whatsapp ? (['whatsapp'] as const) : []),
      ...(providers.telegram && providers.telegramBotUsername ? (['telegram'] as const) : []),
      ...WEBHOOK_SUBSCRIBER_KINDS,
    ];
    const components = await this.prisma.client.pageComponent.findMany({
      where: { pageId: page.id },
      orderBy: { position: 'asc' },
      select: { component: { select: { id: true, name: true } } },
    });
    return {
      page: { slug: page.slug, name: page.name },
      kinds,
      components: components.map((c) => c.component),
      consentVersion: CONSENT_VERSION,
    };
  }

  async subscribe(slug: string, input: SubscribeInput, auth: AuthContext | undefined, meta: Meta) {
    const page = await this.viewablePage(slug, auth, meta.ip);
    await this.rateLimit.enforce(`subscribe:ip:${meta.ip}`, 20, 3600);
    const options = await this.options(slug, auth, meta.ip);
    if (!options.kinds.includes(input.kind)) {
      throw new BadRequestException({ message: 'channel_unavailable' });
    }
    const componentIds = input.allComponents ? [] : [...new Set(input.componentIds)];
    const known = new Set(options.components.map((c) => c.id));
    if (componentIds.some((id) => !known.has(id))) {
      throw new BadRequestException({ message: 'component_not_found' });
    }
    const consentText = `subscribe:${CONSENT_VERSION}:${input.locale}`;
    const prefs = {
      locale: input.locale,
      allComponents: input.allComponents,
      eventTypes: input.events,
      components: {
        deleteMany: {},
        create: componentIds.map((componentId) => ({ componentId })),
      },
    };

    if (input.kind === 'telegram') {
      // O chat só é conhecido depois do /start: cada pedido cria uma inscrição pendente.
      const linkToken = newToken();
      const manageToken = newToken();
      const sub = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.subscriber.create({
          data: {
            pageId: page.id,
            kind: 'telegram',
            locale: input.locale,
            allComponents: input.allComponents,
            eventTypes: input.events,
            components: { create: componentIds.map((componentId) => ({ componentId })) },
            manageTokenEnc: this.secrets.encrypt(manageToken),
            manageTokenHash: hashToken(manageToken),
            linkTokenHash: hashToken(linkToken),
            linkExpiresAt: new Date(Date.now() + TELEGRAM_LINK_TTL_MS),
          },
        });
        await this.consent(tx, created, 'subscribe', meta, consentText);
        return created;
      });
      const providers = await this.notify.providers();
      return {
        next: 'telegram' as const,
        pendingToken: linkToken,
        link: `https://t.me/${providers.telegramBotUsername}?start=${linkToken}`,
        subscriberId: sub.id,
      };
    }

    const target = normalizeTarget(input.kind, input.target);
    const targetHash = this.targetHash(input.kind, target);
    if (isWebhookKind(input.kind)) {
      try {
        await assertSubscriberWebhook(input.kind, target, {
          extraHosts: this.notify.env.webhookExtraHosts,
        });
      } catch (error) {
        throw new BadRequestException({
          message: 'invalid_webhook',
          reason: (error as Error).message,
        });
      }
    }

    const existing = await this.prisma.client.subscriber.findUnique({
      where: { pageId_kind_targetHash: { pageId: page.id, kind: input.kind, targetHash } },
    });
    const linkToken = newToken();
    let sub: Subscriber;
    if (existing) {
      // Já ativo: as preferências só mudam pelo link de gerenciamento (quem prova
      // ser dono do contato). Aqui só se renova a confirmação.
      sub = await this.prisma.client.$transaction(async (tx) => {
        const updated = await tx.subscriber.update({
          where: { id: existing.id },
          data: {
            ...(existing.status === 'active' ? {} : { ...prefs, status: 'pending' }),
            linkTokenHash: hashToken(linkToken),
            linkExpiresAt: new Date(Date.now() + CODE_TTL_MS * 4),
            source: existing.status === 'active' ? existing.source : 'form',
          },
        });
        await this.consent(tx, updated, 'subscribe', meta, consentText);
        return updated;
      });
    } else {
      const manageToken = newToken();
      sub = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.subscriber.create({
          data: {
            pageId: page.id,
            kind: input.kind,
            targetEnc: this.secrets.encrypt(target),
            targetHash,
            targetDisplay: maskTarget(input.kind, target),
            locale: input.locale,
            allComponents: input.allComponents,
            eventTypes: input.events,
            components: { create: componentIds.map((componentId) => ({ componentId })) },
            manageTokenEnc: this.secrets.encrypt(manageToken),
            manageTokenHash: hashToken(manageToken),
            linkTokenHash: hashToken(linkToken),
            linkExpiresAt: new Date(Date.now() + CODE_TTL_MS * 4),
          },
        });
        await this.consent(tx, created, 'subscribe', meta, consentText);
        return created;
      });
    }

    if (isWebhookKind(input.kind)) {
      // Webhook: a validação é a mensagem de teste chegar ao destino.
      await this.sendWebhookTest(page, sub, target);
      const manageToken = await this.activate(sub, meta, 'webhook_test');
      return { next: 'active' as const, manageToken };
    }

    await this.sendCode(page, sub, meta);
    return {
      next: 'code' as const,
      pendingToken: linkToken,
      target: maskTarget(input.kind, target),
    };
  }

  private async sendWebhookTest(page: Page, sub: Subscriber, target: string) {
    const pageUrl = await pageBaseUrl(this.prisma.client, page, this.notify.env.publicUrl);
    const manageToken = this.secrets.decrypt(sub.manageTokenEnc);
    const message = renderTestMessage(page, sub.locale, {
      pageUrl,
      itemUrl: pageUrl,
      manageUrl: `${pageUrl}/subscription/${manageToken}`,
      unsubscribeUrl: `${pageUrl}/subscription/${manageToken}?action=unsubscribe`,
    });
    try {
      await deliver(subscriberDestination(sub.kind, target), message, {});
    } catch (error) {
      throw new BadRequestException({
        message: 'webhook_test_failed',
        reason: (error as Error).message.slice(0, 200),
      });
    }
  }

  /** Gera e envia um novo código (invalida os anteriores), respeitando os limites. */
  private async sendCode(page: Page, sub: Subscriber, meta: Meta) {
    const last = await this.prisma.client.verificationCode.findFirst({
      where: { subscriberId: sub.id },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < CODE_RESEND_AFTER_MS) {
      throw tooManyRequests(
        Math.ceil((CODE_RESEND_AFTER_MS - (Date.now() - last.createdAt.getTime())) / 1000),
      );
    }
    await this.rateLimit.enforce(`code:target:${sub.targetHash}`, CODE_SENDS_PER_HOUR, 3600);
    await this.rateLimit.enforce(`code:ip:${meta.ip}`, CODE_SENDS_PER_HOUR, 3600);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = new Date();
    await this.prisma.client.$transaction([
      this.prisma.client.verificationCode.updateMany({
        where: { subscriberId: sub.id, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.client.verificationCode.create({
        data: {
          subscriberId: sub.id,
          codeHash: this.secrets.mac(`code:${sub.id}:${code}`),
          expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        },
      }),
    ]);

    const target = this.secrets.decrypt(sub.targetEnc!);
    const providers = await this.notify.providers();
    try {
      if (sub.kind === 'whatsapp') {
        if (!providers.whatsapp) throw new Error('whatsapp_not_configured');
        await whatsappCode(providers.whatsapp, target, code);
      } else {
        if (!providers.smtp) throw new Error('smtp_not_configured');
        const texts = verificationTexts('code', sub.locale, { pageName: page.name, code });
        await sendEmail(providers.smtp, [target], texts);
      }
    } catch {
      throw new BadGatewayException({ message: 'send_failed' });
    }
  }

  private async pendingByToken(token: string) {
    const sub = await this.prisma.client.subscriber.findUnique({
      where: { linkTokenHash: hashToken(token) },
      include: { page: true },
    });
    if (!sub || (sub.linkExpiresAt && sub.linkExpiresAt < new Date() && sub.status !== 'active')) {
      throw new NotFoundException({ message: 'subscription_not_found' });
    }
    return sub;
  }

  async confirm(pendingToken: string, code: string, meta: Meta) {
    const sub = await this.pendingByToken(pendingToken);
    if (sub.kind !== 'email' && sub.kind !== 'whatsapp') {
      throw new NotFoundException({ message: 'subscription_not_found' });
    }
    const current = await this.prisma.client.verificationCode.findFirst({
      where: { subscriberId: sub.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!current) throw new BadRequestException({ message: 'code_expired' });
    if (current.attempts >= CODE_MAX_ATTEMPTS) {
      throw new BadRequestException({ message: 'code_attempts_exceeded' });
    }
    const expected = Buffer.from(current.codeHash);
    const given = Buffer.from(this.secrets.mac(`code:${sub.id}:${code}`));
    if (!timingSafeEqual(expected, given)) {
      const updated = await this.prisma.client.verificationCode.update({
        where: { id: current.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({
        message: updated.attempts >= CODE_MAX_ATTEMPTS ? 'code_attempts_exceeded' : 'invalid_code',
        attemptsLeft: Math.max(0, CODE_MAX_ATTEMPTS - updated.attempts),
      });
    }
    await this.prisma.client.verificationCode.update({
      where: { id: current.id },
      data: { consumedAt: new Date() },
    });
    return { manageToken: await this.activate(sub, meta, 'code') };
  }

  async resend(pendingToken: string, meta: Meta) {
    const sub = await this.pendingByToken(pendingToken);
    if (sub.kind !== 'email' && sub.kind !== 'whatsapp') {
      throw new NotFoundException({ message: 'subscription_not_found' });
    }
    await this.sendCode(sub.page, sub, meta);
    return { ok: true };
  }

  /** Estado da inscrição pendente (a tela do Telegram consulta até o /start). */
  async pendingStatus(pendingToken: string) {
    const sub = await this.prisma.client.subscriber.findUnique({
      where: { linkTokenHash: hashToken(pendingToken) },
    });
    if (!sub) throw new NotFoundException({ message: 'subscription_not_found' });
    if (sub.status === 'active') {
      return { status: 'active' as const, manageToken: this.secrets.decrypt(sub.manageTokenEnc) };
    }
    return { status: sub.status };
  }

  /** Convite de importação: o link do e-mail confirma a inscrição. */
  async acceptInvite(token: string, meta: Meta) {
    const sub = await this.pendingByToken(token);
    if (sub.source !== 'import') throw new NotFoundException({ message: 'subscription_not_found' });
    return { manageToken: await this.activate(sub, meta, 'invite') };
  }

  private async activate(sub: Subscriber, meta: Meta, how: string): Promise<string> {
    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.subscriber.update({
        where: { id: sub.id },
        data: {
          status: 'active',
          confirmedAt: sub.confirmedAt ?? new Date(),
          unsubscribedAt: null,
          linkTokenHash: null,
          linkExpiresAt: null,
        },
      });
      await this.consent(tx, updated, 'confirm', meta, `confirm:${how}`);
    });
    return this.secrets.decrypt(sub.manageTokenEnc);
  }

  // --- Gerenciamento pelo assinante -------------------------------------------------

  private async byManageToken(token: string) {
    const sub = await this.prisma.client.subscriber.findUnique({
      where: { manageTokenHash: hashToken(token) },
      include: { page: true, components: { select: { componentId: true } } },
    });
    if (!sub) throw new NotFoundException({ message: 'subscription_not_found' });
    return sub;
  }

  async manageGet(token: string) {
    const sub = await this.byManageToken(token);
    const components = await this.prisma.client.pageComponent.findMany({
      where: { pageId: sub.pageId },
      orderBy: { position: 'asc' },
      select: { component: { select: { id: true, name: true } } },
    });
    return {
      page: { slug: sub.page.slug, name: sub.page.name },
      kind: sub.kind,
      target: sub.targetDisplay,
      status: sub.status,
      locale: sub.locale,
      allComponents: sub.allComponents,
      componentIds: sub.components.map((c) => c.componentId),
      events: sub.eventTypes,
      confirmedAt: sub.confirmedAt,
      components: components.map((c) => c.component),
    };
  }

  async manageUpdate(
    token: string,
    input: { locale: string; allComponents: boolean; componentIds: string[]; events: string[] },
    meta: Meta,
  ) {
    const sub = await this.byManageToken(token);
    const known = new Set(
      (
        await this.prisma.client.pageComponent.findMany({
          where: { pageId: sub.pageId },
          select: { componentId: true },
        })
      ).map((c) => c.componentId),
    );
    const ids = input.allComponents ? [] : [...new Set(input.componentIds)];
    if (ids.some((id) => !known.has(id))) {
      throw new BadRequestException({ message: 'component_not_found' });
    }
    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.subscriber.update({
        where: { id: sub.id },
        data: {
          locale: isLocale(input.locale) ? input.locale : sub.locale,
          allComponents: input.allComponents,
          eventTypes: input.events,
          components: { deleteMany: {}, create: ids.map((componentId) => ({ componentId })) },
        },
      });
      await this.consent(tx, updated, 'update', meta, `update:${CONSENT_VERSION}`);
    });
    return this.manageGet(token);
  }

  async unsubscribe(token: string, meta: Meta) {
    const sub = await this.byManageToken(token);
    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.subscriber.update({
        where: { id: sub.id },
        data: { status: 'unsubscribed', unsubscribedAt: new Date() },
      });
      await this.consent(tx, updated, 'unsubscribe', meta, 'unsubscribe');
    });
    return this.manageGet(token);
  }

  /** Exclusão dos dados (LGPD): só fica o registro de consentimento, sem o contato. */
  async erase(token: string, meta: Meta) {
    const sub = await this.byManageToken(token);
    await this.prisma.client.$transaction(async (tx) => {
      await this.consent(tx, sub, 'delete', meta, 'erase');
      await tx.subscriber.delete({ where: { id: sub.id } });
    });
  }

  // --- Painel (Admin) ---------------------------------------------------------------

  async list(pageId: string, filter: { status?: string; kind?: string }) {
    const subs = await this.prisma.client.subscriber.findMany({
      where: {
        pageId,
        ...(filter.status ? { status: filter.status as Subscriber['status'] } : {}),
        ...(filter.kind ? { kind: filter.kind as Subscriber['kind'] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        kind: true,
        targetDisplay: true,
        locale: true,
        status: true,
        source: true,
        allComponents: true,
        eventTypes: true,
        confirmedAt: true,
        createdAt: true,
        _count: { select: { components: true } },
      },
    });
    const counts = await this.prisma.client.subscriber.groupBy({
      by: ['status'],
      where: { pageId },
      _count: true,
    });
    return {
      items: subs.map(({ _count, ...s }) => ({ ...s, componentCount: _count.components })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  async remove(pageId: string, subscriberId: string, audit: AuditContext) {
    const sub = await this.prisma.client.subscriber.findFirst({
      where: { id: subscriberId, pageId },
    });
    if (!sub) throw new NotFoundException({ message: 'subscriber_not_found' });
    await this.prisma.client.$transaction(async (tx) => {
      await this.consent(tx, sub, 'delete', audit, 'admin_delete');
      await tx.subscriber.delete({ where: { id: subscriberId } });
      await recordAudit(tx, {
        ...audit,
        action: 'subscriber.delete',
        entityType: 'subscriber',
        entityId: subscriberId,
        pageId,
        before: { kind: sub.kind, target: sub.targetDisplay },
      });
    });
  }

  /** Exportação com os contatos completos (para migração); fica na auditoria. */
  async exportCsv(pageId: string, audit: AuditContext): Promise<string> {
    const subs = await this.prisma.client.subscriber.findMany({
      where: { pageId, targetEnc: { not: null } },
      orderBy: { createdAt: 'asc' },
      include: { components: { include: { component: { select: { name: true } } } } },
    });
    await recordAudit(this.prisma.client, {
      ...audit,
      action: 'subscriber.export',
      entityType: 'page',
      entityId: pageId,
      pageId,
      after: { count: subs.length },
    });
    return toCsv([
      [
        'channel',
        'target',
        'locale',
        'status',
        'events',
        'components',
        'confirmed_at',
        'created_at',
      ],
      ...subs.map((s) => [
        s.kind,
        this.secrets.decrypt(s.targetEnc!),
        s.locale,
        s.status,
        s.eventTypes.join('|'),
        s.allComponents ? '*' : s.components.map((c) => c.component.name).join('|'),
        s.confirmedAt?.toISOString() ?? '',
        s.createdAt.toISOString(),
      ]),
    ]);
  }

  /**
   * Importa e-mails (coluna `email`, opcionais `locale` e `components`, nomes
   * separados por `|`). Cada contato recebe um convite: sem confirmar pelo
   * link, nada é enviado. Contatos já ativos são mantidos.
   */
  async importCsv(pageId: string, csv: string, audit: AuditContext) {
    const providers = await this.notify.providers();
    if (!providers.smtp) throw new BadRequestException({ message: 'smtp_not_configured' });
    const rows = parseCsv(csv);
    const header = rows.shift()?.map((h) => h.toLowerCase()) ?? [];
    const col = (name: string) => header.indexOf(name);
    const emailCol = col('email') >= 0 ? col('email') : col('target');
    if (emailCol < 0) throw new BadRequestException({ message: 'csv_missing_email' });
    if (rows.length > IMPORT_MAX_ROWS) throw new BadRequestException({ message: 'csv_too_large' });

    const page = await this.prisma.client.page.findUniqueOrThrow({ where: { id: pageId } });
    const pageUrl = await pageBaseUrl(this.prisma.client, page, this.notify.env.publicUrl);
    const components = await this.prisma.client.pageComponent.findMany({
      where: { pageId },
      select: { component: { select: { id: true, name: true } } },
    });
    const byName = new Map(components.map((c) => [c.component.name.toLowerCase(), c.component.id]));
    const result = { invited: 0, skipped: 0, invalid: [] as number[] };

    for (const [index, row] of rows.entries()) {
      const email = normalizeTarget('email', row[emailCol] ?? '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        result.invalid.push(index + 2);
        continue;
      }
      const localeRaw = col('locale') >= 0 ? row[col('locale')] : '';
      const locale = localeRaw && isLocale(localeRaw) ? localeRaw : page.defaultLocale;
      const names = col('components') >= 0 ? (row[col('components')] ?? '') : '';
      const componentIds =
        names && names !== '*'
          ? names
              .split('|')
              .map((n) => byName.get(n.trim().toLowerCase()))
              .filter((id): id is string => Boolean(id))
          : [];
      const targetHash = this.targetHash('email', email);
      const existing = await this.prisma.client.subscriber.findUnique({
        where: { pageId_kind_targetHash: { pageId, kind: 'email', targetHash } },
      });
      if (existing?.status === 'active') {
        result.skipped++;
        continue;
      }
      const linkToken = newToken();
      const data = {
        locale,
        allComponents: componentIds.length === 0,
        source: 'import',
        status: 'pending' as const,
        linkTokenHash: hashToken(linkToken),
        linkExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
      };
      if (existing) {
        await this.prisma.client.subscriber.update({
          where: { id: existing.id },
          data: {
            ...data,
            components: {
              deleteMany: {},
              create: componentIds.map((componentId) => ({ componentId })),
            },
          },
        });
      } else {
        const manageToken = newToken();
        await this.prisma.client.subscriber.create({
          data: {
            ...data,
            pageId,
            kind: 'email',
            targetEnc: this.secrets.encrypt(email),
            targetHash,
            targetDisplay: maskTarget('email', email),
            manageTokenEnc: this.secrets.encrypt(manageToken),
            manageTokenHash: hashToken(manageToken),
            components: { create: componentIds.map((componentId) => ({ componentId })) },
          },
        });
      }
      const link = `${pageUrl}/subscription/invite/${linkToken}`;
      try {
        await sendEmail(
          providers.smtp,
          [email],
          verificationTexts('invite', locale, { pageName: page.name, link }),
        );
        result.invited++;
      } catch {
        result.invalid.push(index + 2);
      }
    }
    await recordAudit(this.prisma.client, {
      ...audit,
      action: 'subscriber.import',
      entityType: 'page',
      entityId: pageId,
      pageId,
      after: { invited: result.invited, skipped: result.skipped, invalid: result.invalid.length },
    });
    return result;
  }
}
