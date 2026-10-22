import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type AuditContext, recordAudit, releaseSignals, runCheck } from '@status-page/core';
import { type Monitor } from '@status-page/db';
import { type MetricRange, type MonitorInput, monitorConfigSchemas } from '@status-page/shared';
import { assertComponentsInPage } from '../common/page-guards.js';
import { NotifyService } from '../infra/notify.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SecretsService } from '../infra/secrets.service.js';
import { metricSeries } from './metrics.js';

/** Monitores ativos (HTTP, TCP, ICMP, DNS, SSL) de uma página. Configuração: Admin. */
@Injectable()
export class MonitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly notify: NotifyService,
  ) {}

  async list(pageId: string) {
    const monitors = await this.prisma.client.monitor.findMany({
      where: { pageId },
      orderBy: { name: 'asc' },
      include: { component: { select: { id: true, name: true, status: true } } },
    });
    return monitors.map((m) => this.view(m));
  }

  async get(pageId: string, monitorId: string) {
    return this.view(await this.find(pageId, monitorId));
  }

  async create(pageId: string, input: MonitorInput, audit: AuditContext) {
    const data = await this.prepare(pageId, input, null);
    const monitor = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.monitor.create({ data: { pageId, ...data } });
      await recordAudit(tx, {
        ...audit,
        action: 'monitor.create',
        entityType: 'monitor',
        entityId: created.id,
        pageId,
        after: this.auditView(created),
      });
      return created;
    });
    return this.view(monitor);
  }

  async update(pageId: string, monitorId: string, input: MonitorInput, audit: AuditContext) {
    const before = await this.find(pageId, monitorId);
    const data = await this.prepare(pageId, input, before);
    // Trocar o alvo, o componente ou desligar o monitor encerra o que ele tinha aplicado.
    const reset =
      !input.enabled ||
      before.componentId !== data.componentId ||
      before.type !== data.type ||
      before.target !== data.target;
    const monitor = await this.prisma.client.$transaction(async (tx) => {
      if (reset) await releaseSignals(tx, `monitor:${monitorId}`, audit.actorId);
      const updated = await tx.monitor.update({
        where: { id: monitorId },
        data: {
          ...data,
          ...(reset ? { state: 'unknown', consecutiveFailures: 0, consecutiveSuccesses: 0 } : {}),
          // Mudanças valem já na próxima volta do agendador.
          nextCheckAt: new Date(),
        },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'monitor.update',
        entityType: 'monitor',
        entityId: monitorId,
        pageId,
        before: this.auditView(before),
        after: this.auditView(updated),
      });
      return updated;
    });
    await this.notify.flush();
    return this.view(monitor);
  }

  async remove(pageId: string, monitorId: string, audit: AuditContext): Promise<void> {
    const before = await this.find(pageId, monitorId);
    await this.prisma.client.$transaction(async (tx) => {
      await releaseSignals(tx, `monitor:${monitorId}`, audit.actorId);
      await tx.monitor.delete({ where: { id: monitorId } });
      await recordAudit(tx, {
        ...audit,
        action: 'monitor.delete',
        entityType: 'monitor',
        entityId: monitorId,
        pageId,
        before: this.auditView(before),
      });
    });
    await this.notify.flush();
  }

  /** "Testar agora": roda a checagem com a configuração informada, sem gravar nada. */
  async test(pageId: string, input: MonitorInput, monitorId?: string) {
    const existing = monitorId ? await this.find(pageId, monitorId) : null;
    const config = monitorConfigSchemas[input.type].parse(input.config);
    const headers =
      input.headers ??
      (existing?.headersEnc
        ? (JSON.parse(this.secrets.decrypt(existing.headersEnc)) as Record<string, string>)
        : undefined);
    return runCheck({
      type: input.type,
      target: input.target,
      config,
      headers,
      timeoutMs: input.timeoutMs,
    });
  }

  /** Últimas checagens e a série de latência/disponibilidade do período. */
  async results(pageId: string, monitorId: string, range: MetricRange) {
    await this.find(pageId, monitorId);
    const [recent, series] = await Promise.all([
      this.prisma.client.monitorCheckResult.findMany({
        where: { monitorId },
        orderBy: { checkedAt: 'desc' },
        take: 50,
        select: { checkedAt: true, ok: true, latencyMs: true, error: true },
      }),
      metricSeries(this.prisma.client, [monitorId], range),
    ]);
    return { recent, ...series.get(monitorId)! };
  }

  private async prepare(pageId: string, input: MonitorInput, before: Monitor | null) {
    if (input.componentId)
      await assertComponentsInPage(this.prisma.client, pageId, [input.componentId]);
    if (input.templateId) {
      const template = await this.prisma.client.incidentTemplate.findFirst({
        where: { id: input.templateId, pageId },
      });
      if (!template) throw new NotFoundException({ message: 'template_not_found' });
    }
    if (input.type !== 'http' && input.headers && Object.keys(input.headers).length > 0) {
      throw new BadRequestException({ message: 'headers_only_http' });
    }
    let headersEnc = before?.headersEnc ?? null;
    if (input.headers !== undefined) {
      headersEnc =
        Object.keys(input.headers).length > 0
          ? this.secrets.encrypt(JSON.stringify(input.headers))
          : null;
    }
    if (input.type !== 'http') headersEnc = null;
    return {
      name: input.name,
      componentId: input.componentId,
      type: input.type,
      target: input.target,
      config: monitorConfigSchemas[input.type].parse(input.config),
      headersEnc,
      intervalSeconds: input.intervalSeconds,
      timeoutMs: input.timeoutMs,
      failureThreshold: input.failureThreshold,
      recoveryThreshold: input.recoveryThreshold,
      mode: input.mode,
      failureStatus: input.failureStatus,
      templateId: input.templateId,
      publicMetrics: input.publicMetrics,
      enabled: input.enabled,
    };
  }

  private async find(pageId: string, monitorId: string) {
    const monitor = await this.prisma.client.monitor.findFirst({
      where: { id: monitorId, pageId },
      include: { component: { select: { id: true, name: true, status: true } } },
    });
    if (!monitor) throw new NotFoundException({ message: 'monitor_not_found' });
    return monitor;
  }

  /** Nunca devolve os valores dos cabeçalhos (podem ter credenciais), só os nomes. */
  private view(
    monitor: Monitor & { component?: { id: string; name: string; status: string } | null },
  ) {
    const { headersEnc, ...rest } = monitor;
    const headerNames = headersEnc
      ? Object.keys(JSON.parse(this.secrets.decrypt(headersEnc)) as object)
      : [];
    return { ...rest, headerNames };
  }

  private auditView(monitor: Monitor) {
    const { headersEnc, ...rest } = monitor;
    return { ...rest, hasHeaders: Boolean(headersEnc) };
  }
}
