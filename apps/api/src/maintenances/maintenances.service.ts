import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AuditContext,
  completeMaintenance,
  recordAudit,
  startMaintenance,
} from '@status-page/core';
import { type MaintenanceCreateInput, type MaintenanceStatus } from '@status-page/shared';
import { assertComponentsInPage } from '../common/page-guards.js';
import { PrismaService } from '../infra/prisma.service.js';

interface MaintenanceEditInput {
  title?: string;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  autoStart?: boolean;
  autoComplete?: boolean;
  componentIds?: string[];
}

const DETAIL_INCLUDE = {
  updates: {
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  },
  components: { include: { component: { select: { id: true, name: true, status: true } } } },
  createdBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class MaintenancesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    pageId: string,
    filter: { status?: MaintenanceStatus; limit: number; cursor?: string },
  ) {
    const items = await this.prisma.client.maintenance.findMany({
      where: { pageId, ...(filter.status ? { status: filter.status } : {}) },
      orderBy: [{ scheduledStart: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: { components: { include: { component: { select: { id: true, name: true } } } } },
    });
    const hasMore = items.length > filter.limit;
    const page = items.slice(0, filter.limit);
    return { items: page, nextCursor: hasMore ? page.at(-1)?.id : undefined };
  }

  async get(pageId: string, maintenanceId: string) {
    const maintenance = await this.prisma.client.maintenance.findFirst({
      where: { id: maintenanceId, pageId },
      include: DETAIL_INCLUDE,
    });
    if (!maintenance) throw new NotFoundException({ message: 'maintenance_not_found' });
    return maintenance;
  }

  async create(pageId: string, input: MaintenanceCreateInput, audit: AuditContext) {
    await assertComponentsInPage(this.prisma.client, pageId, input.componentIds);
    const id = await this.prisma.client.$transaction(async (tx) => {
      const maintenance = await tx.maintenance.create({
        data: {
          pageId,
          title: input.title,
          scheduledStart: input.scheduledStart,
          scheduledEnd: input.scheduledEnd,
          autoStart: input.autoStart,
          autoComplete: input.autoComplete,
          createdById: audit.actorId ?? null,
          components: {
            create: [...new Set(input.componentIds)].map((componentId) => ({ componentId })),
          },
          updates: {
            create: {
              status: 'scheduled',
              body: input.body,
              notify: input.notify,
              createdById: audit.actorId ?? null,
            },
          },
        },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'maintenance.create',
        entityType: 'maintenance',
        entityId: maintenance.id,
        pageId,
        after: { ...maintenance, body: input.body, componentIds: input.componentIds },
      });
      // Janela já iniciada: começa agora, sem esperar o worker.
      if (input.autoStart && input.scheduledStart <= new Date()) {
        await startMaintenance(tx, maintenance.id, { actorId: audit.actorId });
      }
      return maintenance.id;
    });
    return this.get(pageId, id);
  }

  async edit(
    pageId: string,
    maintenanceId: string,
    input: MaintenanceEditInput,
    audit: AuditContext,
  ) {
    const before = await this.get(pageId, maintenanceId);
    if (before.status === 'completed') {
      throw new BadRequestException({ message: 'maintenance_completed' });
    }
    if (before.status === 'in_progress' && (input.scheduledStart || input.componentIds)) {
      // Início e componentes só mudam antes de a manutenção começar.
      throw new BadRequestException({ message: 'maintenance_in_progress' });
    }
    const start = input.scheduledStart ?? before.scheduledStart;
    const end = input.scheduledEnd ?? before.scheduledEnd;
    if (start >= end) throw new BadRequestException({ message: 'invalid_window' });
    if (input.componentIds) {
      await assertComponentsInPage(this.prisma.client, pageId, input.componentIds);
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { componentIds, ...fields } = input;
      const maintenance = await tx.maintenance.update({
        where: { id: maintenanceId },
        data: fields,
      });
      if (componentIds) {
        await tx.maintenanceComponent.deleteMany({ where: { maintenanceId } });
        await tx.maintenanceComponent.createMany({
          data: [...new Set(componentIds)].map((componentId) => ({ maintenanceId, componentId })),
        });
      }
      await recordAudit(tx, {
        ...audit,
        action: 'maintenance.edit',
        entityType: 'maintenance',
        entityId: maintenanceId,
        pageId,
        before,
        after: { ...maintenance, componentIds },
      });
    });
    return this.get(pageId, maintenanceId);
  }

  async addUpdate(
    pageId: string,
    maintenanceId: string,
    input: { body: string; status?: 'in_progress' | 'completed'; notify: boolean },
    audit: AuditContext,
  ) {
    const maintenance = await this.get(pageId, maintenanceId);
    await this.prisma.client.$transaction(async (tx) => {
      const options = { actorId: audit.actorId, body: input.body, notify: input.notify };
      if (input.status === 'in_progress' && maintenance.status !== 'in_progress') {
        if (maintenance.status !== 'scheduled') {
          throw new BadRequestException({ message: 'invalid_transition' });
        }
        await startMaintenance(tx, maintenanceId, options);
        return;
      }
      if (input.status === 'completed' && maintenance.status !== 'completed') {
        await completeMaintenance(tx, maintenanceId, options);
        return;
      }
      if (!input.body) throw new BadRequestException({ message: 'body_required' });
      await tx.maintenanceUpdate.create({
        data: {
          maintenanceId,
          status: maintenance.status,
          body: input.body,
          notify: input.notify,
          createdById: audit.actorId ?? null,
        },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'maintenance.update',
        entityType: 'maintenance',
        entityId: maintenanceId,
        pageId,
        after: { body: input.body },
      });
    });
    return this.get(pageId, maintenanceId);
  }

  /** Exclui (cancela) uma manutenção que não esteja em andamento. */
  async remove(pageId: string, maintenanceId: string, audit: AuditContext): Promise<void> {
    const before = await this.get(pageId, maintenanceId);
    if (before.status === 'in_progress') {
      throw new BadRequestException({ message: 'maintenance_in_progress' });
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.maintenance.delete({ where: { id: maintenanceId } });
      await recordAudit(tx, {
        ...audit,
        action: 'maintenance.delete',
        entityType: 'maintenance',
        entityId: maintenanceId,
        pageId,
        before,
      });
    });
  }
}
