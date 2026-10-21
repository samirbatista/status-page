import { Injectable, NotFoundException } from '@nestjs/common';
import { acceptAlert, type AuditContext, dismissAlert, recordAudit } from '@status-page/core';
import { type AlertState } from '@status-page/db';
import { NotifyService } from '../infra/notify.service.js';
import { PrismaService } from '../infra/prisma.service.js';

/** Sugestões do modo "sugestão": o operador aceita (aplica) ou descarta. */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  list(pageId: string, state: AlertState | 'all') {
    return this.prisma.client.alert.findMany({
      where: { pageId, ...(state === 'all' ? {} : { state }) },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
      include: { component: { select: { id: true, name: true, status: true } } },
    });
  }

  async accept(pageId: string, alertId: string, openIncident: boolean, audit: AuditContext) {
    await this.find(pageId, alertId);
    const outcome = await this.prisma.client.$transaction(async (tx) => {
      const result = await acceptAlert(tx, alertId, {
        actorId: audit.actorId!,
        openIncident,
      });
      await recordAudit(tx, {
        ...audit,
        action: 'alert.accept',
        entityType: 'alert',
        entityId: alertId,
        pageId,
        after: { outcome: result, openIncident },
      });
      return result;
    });
    await this.notify.flush();
    return { outcome };
  }

  async dismiss(pageId: string, alertId: string, audit: AuditContext) {
    await this.find(pageId, alertId);
    await this.prisma.client.$transaction(async (tx) => {
      await dismissAlert(tx, alertId, audit.actorId!);
      await recordAudit(tx, {
        ...audit,
        action: 'alert.dismiss',
        entityType: 'alert',
        entityId: alertId,
        pageId,
      });
    });
  }

  private async find(pageId: string, alertId: string) {
    const alert = await this.prisma.client.alert.findFirst({ where: { id: alertId, pageId } });
    if (!alert) throw new NotFoundException({ message: 'alert_not_found' });
    return alert;
  }
}
