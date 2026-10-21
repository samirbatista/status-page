import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type AuditContext,
  backfillComponentStatus,
  type Db,
  recordAudit,
  recordIncidentEvent,
  setComponentStatuses,
  type StatusChange,
} from '@status-page/core';
import {
  type IncidentCreateInput,
  type IncidentImpact,
  type IncidentUpdateCreateInput,
} from '@status-page/shared';
import { assertComponentsInPage } from '../common/page-guards.js';
import { NotifyService } from '../infra/notify.service.js';
import { PrismaService } from '../infra/prisma.service.js';

const DETAIL_INCLUDE = {
  updates: {
    orderBy: { displayAt: 'desc' },
    include: {
      components: { include: { component: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
  },
  createdBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  async list(pageId: string, filter: { active?: boolean; cursor?: string; limit: number }) {
    const incidents = await this.prisma.client.incident.findMany({
      where: {
        pageId,
        ...(filter.active === undefined
          ? {}
          : filter.active
            ? { status: { not: 'resolved' } }
            : { status: 'resolved' }),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: { _count: { select: { updates: true } } },
    });
    const hasMore = incidents.length > filter.limit;
    const items = incidents.slice(0, filter.limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id : undefined };
  }

  async get(pageId: string, incidentId: string) {
    const incident = await this.prisma.client.incident.findFirst({
      where: { id: incidentId, pageId },
      include: DETAIL_INCLUDE,
    });
    if (!incident) throw new NotFoundException({ message: 'incident_not_found' });
    return incident;
  }

  async create(pageId: string, input: IncidentCreateInput, audit: AuditContext) {
    await assertComponentsInPage(
      this.prisma.client,
      pageId,
      input.components.map((c) => c.componentId),
    );

    const id = await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();
      const backfill = input.backfill;
      const status = backfill ? 'resolved' : input.status;
      const incident = await tx.incident.create({
        data: {
          pageId,
          title: input.title,
          impact: input.impact,
          status,
          backfilled: Boolean(backfill),
          startedAt: backfill?.startedAt ?? now,
          resolvedAt: backfill ? backfill.resolvedAt : status === 'resolved' ? now : null,
          createdById: audit.actorId ?? null,
          updates: {
            create: {
              status,
              body: input.body,
              notify: backfill ? false : input.notify,
              displayAt: backfill?.resolvedAt ?? now,
              createdById: audit.actorId ?? null,
              components: { create: input.components },
            },
          },
        },
      });

      if (backfill) {
        // Retroativo: entra no histórico (uptime) sem alterar o status atual.
        for (const c of input.components) {
          await backfillComponentStatus(
            tx,
            c.componentId,
            c.status,
            backfill.startedAt,
            backfill.resolvedAt,
            audit.actorId,
          );
        }
      } else {
        await setComponentStatuses(tx, input.components, { actorId: audit.actorId, at: now });
      }

      // Retroativo nunca notifica.
      if (!backfill && input.notify) {
        await recordIncidentEvent(
          tx,
          incident.id,
          status === 'resolved' ? 'incident_resolved' : 'incident_created',
        );
      }
      await recordAudit(tx, {
        ...audit,
        action: backfill ? 'incident.backfill' : 'incident.create',
        entityType: 'incident',
        entityId: incident.id,
        pageId,
        after: { ...incident, body: input.body, components: input.components },
      });
      return incident.id;
    });
    await this.notify.flush();
    return this.get(pageId, id);
  }

  async addUpdate(
    pageId: string,
    incidentId: string,
    input: IncidentUpdateCreateInput,
    audit: AuditContext,
  ) {
    const incident = await this.get(pageId, incidentId);
    await assertComponentsInPage(
      this.prisma.client,
      pageId,
      input.components.map((c) => c.componentId),
    );

    await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();
      let changes: StatusChange[] = input.components;

      if (input.status === 'resolved' && !incident.backfilled) {
        changes = await this.withResolvedDefaults(tx, incident, input.components);
      }

      const update = await tx.incidentUpdate.create({
        data: {
          incidentId,
          status: input.status,
          body: input.body,
          notify: input.notify,
          displayAt: now,
          createdById: audit.actorId ?? null,
          components: { create: changes },
        },
      });
      await tx.incident.update({
        where: { id: incidentId },
        data: {
          status: input.status,
          resolvedAt: input.status === 'resolved' ? (incident.resolvedAt ?? now) : null,
        },
      });
      if (!incident.backfilled) {
        await setComponentStatuses(tx, changes, { actorId: audit.actorId, at: now });
      }
      if (input.notify && !incident.backfilled) {
        await recordIncidentEvent(
          tx,
          incidentId,
          input.status === 'resolved' ? 'incident_resolved' : 'incident_updated',
          update.id,
        );
      }
      await recordAudit(tx, {
        ...audit,
        action: 'incident.update',
        entityType: 'incident',
        entityId: incidentId,
        pageId,
        before: { status: incident.status },
        after: { status: input.status, body: input.body, components: changes },
      });
    });
    await this.notify.flush();
    return this.get(pageId, incidentId);
  }

  async edit(
    pageId: string,
    incidentId: string,
    input: { title?: string; impact?: IncidentImpact },
    audit: AuditContext,
  ) {
    const before = await this.get(pageId, incidentId);
    await this.prisma.client.$transaction(async (tx) => {
      const incident = await tx.incident.update({ where: { id: incidentId }, data: input });
      await recordAudit(tx, {
        ...audit,
        action: 'incident.edit',
        entityType: 'incident',
        entityId: incidentId,
        pageId,
        before: { title: before.title, impact: before.impact },
        after: { title: incident.title, impact: incident.impact },
      });
    });
    return this.get(pageId, incidentId);
  }

  /** Exclui o incidente. O histórico de status dos componentes é mantido. */
  async remove(pageId: string, incidentId: string, audit: AuditContext): Promise<void> {
    const before = await this.get(pageId, incidentId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.incident.delete({ where: { id: incidentId } });
      await recordAudit(tx, {
        ...audit,
        action: 'incident.delete',
        entityType: 'incident',
        entityId: incidentId,
        pageId,
        before,
      });
    });
  }

  /**
   * Ao resolver, os componentes afetados pelo incidente que não foram citados
   * voltam a `operational` — exceto os em manutenção ou afetados por outro
   * incidente ainda aberto.
   */
  private async withResolvedDefaults(
    tx: Db,
    incident: Awaited<ReturnType<IncidentsService['get']>>,
    explicit: StatusChange[],
  ): Promise<StatusChange[]> {
    const mentioned = new Set(explicit.map((c) => c.componentId));
    const affected = new Set(
      incident.updates.flatMap((u) => u.components.map((c) => c.componentId)),
    );
    const candidates = [...affected].filter((id) => !mentioned.has(id));
    if (candidates.length === 0) return explicit;

    const [inOtherIncidents, components] = await Promise.all([
      tx.incidentUpdateComponent.findMany({
        where: {
          componentId: { in: candidates },
          update: { incident: { id: { not: incident.id }, status: { not: 'resolved' } } },
        },
        select: { componentId: true },
      }),
      tx.component.findMany({
        where: { id: { in: candidates } },
        select: { id: true, status: true },
      }),
    ]);
    const busy = new Set(inOtherIncidents.map((c) => c.componentId));
    const defaults = components
      .filter((c) => !busy.has(c.id) && c.status !== 'under_maintenance')
      .map((c) => ({ componentId: c.id, status: 'operational' as const }));
    return [...explicit, ...defaults];
  }
}
