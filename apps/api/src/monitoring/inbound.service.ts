import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  applySignal,
  type AuditContext,
  matchRule,
  parseInbound,
  recordAudit,
  releaseSignals,
  type SignalOutcome,
  verifyInboundSignature,
} from '@status-page/core';
import { type InboundRule, type InboundSource, Prisma } from '@status-page/db';
import {
  type ComponentStatus,
  genericMappingSchema,
  type inboundRuleInputSchema,
  type inboundSourceInputSchema,
  type inboundSourceUpdateSchema,
} from '@status-page/shared';
import { type z } from 'zod';
import { RateLimitService } from '../common/rate-limit.service.js';
import { assertComponentsInPage } from '../common/page-guards.js';
import { API_ENV, type ApiEnv } from '../env.js';
import { NotifyService } from '../infra/notify.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SecretsService } from '../infra/secrets.service.js';

type SourceInput = z.infer<typeof inboundSourceInputSchema>;
type SourceUpdate = z.infer<typeof inboundSourceUpdateSchema>;
type RuleInput = z.infer<typeof inboundRuleInputSchema>;

/** Alertas processados por requisição (o resto é ignorado). */
const MAX_ALERTS = 100;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Webhooks de entrada: cada origem tem uma URL secreta; os alertas recebidos
 * passam pelas regras (primeira que casar) e viram sinais de falha ou
 * normalização para um componente.
 */
@Injectable()
export class InboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly notify: NotifyService,
    private readonly rateLimit: RateLimitService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async list(pageId: string) {
    const sources = await this.prisma.client.inboundSource.findMany({
      where: { pageId },
      orderBy: { name: 'asc' },
      include: { rules: { orderBy: { position: 'asc' } } },
    });
    return sources.map((s) => this.view(s));
  }

  async create(pageId: string, input: SourceInput, audit: AuditContext) {
    await this.assertTemplate(pageId, input.templateId);
    const token = randomBytes(24).toString('base64url');
    const source = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.inboundSource.create({
        data: {
          pageId,
          kind: input.kind,
          name: input.name,
          mode: input.mode,
          templateId: input.templateId,
          enabled: input.enabled,
          tokenEnc: this.secrets.encrypt(token),
          tokenHash: hashToken(token),
          hmacSecretEnc: input.hmacSecret ? this.secrets.encrypt(input.hmacSecret) : null,
          mapping: genericMappingSchema.parse(input.mapping ?? {}),
        },
        include: { rules: true },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'inbound_source.create',
        entityType: 'inbound_source',
        entityId: created.id,
        pageId,
        after: { name: created.name, kind: created.kind, mode: created.mode },
      });
      return created;
    });
    return this.view(source);
  }

  async update(pageId: string, sourceId: string, input: SourceUpdate, audit: AuditContext) {
    const before = await this.find(pageId, sourceId);
    await this.assertTemplate(pageId, input.templateId);
    let hmacSecretEnc = before.hmacSecretEnc;
    if (input.hmacSecret === null) hmacSecretEnc = null;
    else if (input.hmacSecret) hmacSecretEnc = this.secrets.encrypt(input.hmacSecret);
    const source = await this.prisma.client.$transaction(async (tx) => {
      if (!input.enabled) await releaseSignals(tx, `inbound:${sourceId}:`, audit.actorId);
      const updated = await tx.inboundSource.update({
        where: { id: sourceId },
        data: {
          name: input.name,
          mode: input.mode,
          templateId: input.templateId,
          enabled: input.enabled,
          hmacSecretEnc,
          mapping: input.mapping
            ? genericMappingSchema.parse(input.mapping)
            : (before.mapping as Prisma.InputJsonValue),
        },
        include: { rules: { orderBy: { position: 'asc' } } },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'inbound_source.update',
        entityType: 'inbound_source',
        entityId: sourceId,
        pageId,
        before: { name: before.name, mode: before.mode, enabled: before.enabled },
        after: { name: updated.name, mode: updated.mode, enabled: updated.enabled },
      });
      return updated;
    });
    await this.notify.flush();
    return this.view(source);
  }

  async rotateToken(pageId: string, sourceId: string, audit: AuditContext) {
    await this.find(pageId, sourceId);
    const token = randomBytes(24).toString('base64url');
    const source = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.inboundSource.update({
        where: { id: sourceId },
        data: { tokenEnc: this.secrets.encrypt(token), tokenHash: hashToken(token) },
        include: { rules: { orderBy: { position: 'asc' } } },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'inbound_source.rotate_token',
        entityType: 'inbound_source',
        entityId: sourceId,
        pageId,
      });
      return updated;
    });
    return this.view(source);
  }

  async remove(pageId: string, sourceId: string, audit: AuditContext): Promise<void> {
    const before = await this.find(pageId, sourceId);
    await this.prisma.client.$transaction(async (tx) => {
      await releaseSignals(tx, `inbound:${sourceId}:`, audit.actorId);
      await tx.inboundSource.delete({ where: { id: sourceId } });
      await recordAudit(tx, {
        ...audit,
        action: 'inbound_source.delete',
        entityType: 'inbound_source',
        entityId: sourceId,
        pageId,
        before: { name: before.name, kind: before.kind },
      });
    });
    await this.notify.flush();
  }

  /** Substitui as regras (a ordem da lista é a ordem de avaliação). */
  async setRules(pageId: string, sourceId: string, rules: RuleInput[], audit: AuditContext) {
    await this.find(pageId, sourceId);
    await assertComponentsInPage(
      this.prisma.client,
      pageId,
      rules.map((r) => r.componentId),
    );
    const source = await this.prisma.client.$transaction(async (tx) => {
      await tx.inboundRule.deleteMany({ where: { sourceId } });
      await tx.inboundRule.createMany({
        data: rules.map((rule, position) => ({ sourceId, position, ...rule })),
      });
      await recordAudit(tx, {
        ...audit,
        action: 'inbound_source.rules',
        entityType: 'inbound_source',
        entityId: sourceId,
        pageId,
        after: rules,
      });
      return tx.inboundSource.findUniqueOrThrow({
        where: { id: sourceId },
        include: { rules: { orderBy: { position: 'asc' } } },
      });
    });
    return this.view(source);
  }

  /** Recebimento público (`POST /api/hooks/in/:sourceId/:token`). */
  async receive(
    sourceId: string,
    token: string,
    body: unknown,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    const source = await this.prisma.client.inboundSource.findUnique({
      where: { id: sourceId },
      include: { rules: { orderBy: { position: 'asc' } } },
    });
    // Os dois lados são hashes SHA-256 em hex (mesmo tamanho).
    if (
      !source ||
      !source.enabled ||
      !timingSafeEqual(Buffer.from(hashToken(token)), Buffer.from(source.tokenHash))
    ) {
      throw new NotFoundException({ message: 'not_found' });
    }
    await this.rateLimit.enforce(`inbound:${source.id}`, 120, 60);
    if (source.hmacSecretEnc) {
      const secret = this.secrets.decrypt(source.hmacSecretEnc);
      if (!rawBody || !verifyInboundSignature(secret, rawBody, signature)) {
        throw new UnauthorizedException({ message: 'invalid_signature' });
      }
    }
    if (body === null || typeof body !== 'object') {
      throw new BadRequestException({ message: 'invalid_body' });
    }

    const alerts = parseInbound(
      source.kind,
      body,
      genericMappingSchema.parse(source.mapping ?? {}),
    ).slice(0, MAX_ALERTS);
    const matched: {
      name: string;
      firing: boolean;
      componentId: string;
      outcome: SignalOutcome;
    }[] = [];
    const unmatched: string[] = [];
    await this.prisma.client.$transaction(async (tx) => {
      for (const alert of alerts) {
        const rule = matchRule(source.rules, alert);
        if (!rule) {
          unmatched.push(alert.name);
          continue;
        }
        const outcome = await applySignal(tx, {
          key: `inbound:${source.id}:${alert.key}:${rule.componentId}`,
          pageId: source.pageId,
          componentId: rule.componentId,
          failing: alert.firing,
          status: rule.status as ComponentStatus,
          title: alert.name,
          detail: alert.summary || null,
          mode: source.mode,
          templateId: source.templateId,
          source: 'inbound',
        });
        matched.push({
          name: alert.name,
          firing: alert.firing,
          componentId: rule.componentId,
          outcome,
        });
      }
      await tx.inboundSource.update({
        where: { id: source.id },
        data: {
          lastReceivedAt: new Date(),
          lastResult: { alerts: alerts.length, matched, unmatched: unmatched.slice(0, 20) },
        },
      });
    });
    await this.notify.flush();
    return { received: alerts.length, matched: matched.length, unmatched: unmatched.length };
  }

  private async assertTemplate(pageId: string, templateId: string | null) {
    if (!templateId) return;
    const template = await this.prisma.client.incidentTemplate.findFirst({
      where: { id: templateId, pageId },
    });
    if (!template) throw new NotFoundException({ message: 'template_not_found' });
  }

  private async find(pageId: string, sourceId: string) {
    const source = await this.prisma.client.inboundSource.findFirst({
      where: { id: sourceId, pageId },
    });
    if (!source) throw new NotFoundException({ message: 'inbound_source_not_found' });
    return source;
  }

  private view(source: InboundSource & { rules: InboundRule[] }) {
    const { tokenEnc, hmacSecretEnc, ...fields } = source;
    const { tokenHash, ...rest } = fields;
    void tokenHash;
    const token = this.secrets.decrypt(tokenEnc);
    const base = this.env.PUBLIC_URL.replace(/\/$/, '');
    return {
      ...rest,
      hasHmac: Boolean(hmacSecretEnc),
      url: `${base}/api/hooks/in/${source.id}/${token}`,
    };
  }
}
