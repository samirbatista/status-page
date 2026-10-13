import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type AuditContext, recordAudit, setComponentStatuses } from '@status-page/core';
import { type ComponentCreateInput, type ComponentStatus } from '@status-page/shared';
import { PrismaService } from '../infra/prisma.service.js';

interface GroupInput {
  name?: string;
  collapsed?: boolean;
}

interface ComponentUpdateInput {
  name?: string;
  description?: string;
  groupId?: string | null;
  showUptime?: boolean;
}

interface LayoutInput {
  groups: string[];
  components: { componentId: string; groupId: string | null }[];
}

@Injectable()
export class ComponentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grupos e componentes da página, na ordem de exibição. */
  async structure(pageId: string) {
    const [groups, links] = await Promise.all([
      this.prisma.client.componentGroup.findMany({
        where: { pageId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.client.pageComponent.findMany({
        where: { pageId },
        orderBy: [{ position: 'asc' }],
        include: { component: { include: { _count: { select: { pages: true } } } } },
      }),
    ]);
    return {
      groups,
      components: links.map(({ component, groupId, position, showUptime }) => ({
        id: component.id,
        name: component.name,
        description: component.description,
        status: component.status,
        groupId,
        position,
        showUptime,
        sharedWithPages: component._count.pages - 1,
        updatedAt: component.updatedAt,
      })),
    };
  }

  // --- Grupos ---------------------------------------------------------------

  async createGroup(pageId: string, input: Required<GroupInput>, audit: AuditContext) {
    return this.prisma.client.$transaction(async (tx) => {
      const position = await tx.componentGroup.count({ where: { pageId } });
      const group = await tx.componentGroup.create({ data: { pageId, ...input, position } });
      await recordAudit(tx, {
        ...audit,
        action: 'component_group.create',
        entityType: 'component_group',
        entityId: group.id,
        pageId,
        after: group,
      });
      return group;
    });
  }

  async updateGroup(pageId: string, groupId: string, input: GroupInput, audit: AuditContext) {
    const before = await this.findGroup(pageId, groupId);
    return this.prisma.client.$transaction(async (tx) => {
      const group = await tx.componentGroup.update({ where: { id: groupId }, data: input });
      await recordAudit(tx, {
        ...audit,
        action: 'component_group.update',
        entityType: 'component_group',
        entityId: groupId,
        pageId,
        before,
        after: group,
      });
      return group;
    });
  }

  /** Remove o grupo; os componentes dele ficam sem grupo. */
  async removeGroup(pageId: string, groupId: string, audit: AuditContext): Promise<void> {
    const before = await this.findGroup(pageId, groupId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.componentGroup.delete({ where: { id: groupId } });
      await recordAudit(tx, {
        ...audit,
        action: 'component_group.delete',
        entityType: 'component_group',
        entityId: groupId,
        pageId,
        before,
      });
    });
  }

  // --- Componentes ----------------------------------------------------------

  async create(pageId: string, input: ComponentCreateInput, audit: AuditContext) {
    if (input.groupId) await this.findGroup(pageId, input.groupId);
    return this.prisma.client.$transaction(async (tx) => {
      const position = await tx.pageComponent.count({ where: { pageId } });
      const component = await tx.component.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          status: input.status,
          history: { create: { status: input.status, changedById: audit.actorId ?? null } },
          pages: {
            create: {
              pageId,
              groupId: input.groupId ?? null,
              position,
              showUptime: input.showUptime,
            },
          },
        },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'component.create',
        entityType: 'component',
        entityId: component.id,
        pageId,
        after: { ...component, groupId: input.groupId ?? null },
      });
      return component;
    });
  }

  /** Exibe um componente existente (de outra página) também nesta página. */
  async attach(pageId: string, componentId: string, audit: AuditContext) {
    const component = await this.prisma.client.component.findUnique({ where: { id: componentId } });
    if (!component) throw new NotFoundException({ message: 'component_not_found' });
    return this.prisma.client.$transaction(async (tx) => {
      const position = await tx.pageComponent.count({ where: { pageId } });
      await tx.pageComponent.upsert({
        where: { pageId_componentId: { pageId, componentId } },
        create: { pageId, componentId, position },
        update: {},
      });
      await recordAudit(tx, {
        ...audit,
        action: 'component.attach',
        entityType: 'component',
        entityId: componentId,
        pageId,
      });
      return component;
    });
  }

  async update(
    pageId: string,
    componentId: string,
    input: ComponentUpdateInput,
    audit: AuditContext,
  ) {
    const link = await this.findLink(pageId, componentId);
    if (input.groupId) await this.findGroup(pageId, input.groupId);
    return this.prisma.client.$transaction(async (tx) => {
      const component = await tx.component.update({
        where: { id: componentId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      const updatedLink = await tx.pageComponent.update({
        where: { pageId_componentId: { pageId, componentId } },
        data: {
          ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
          ...(input.showUptime !== undefined ? { showUptime: input.showUptime } : {}),
        },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'component.update',
        entityType: 'component',
        entityId: componentId,
        pageId,
        before: link,
        after: { ...component, groupId: updatedLink.groupId, showUptime: updatedLink.showUptime },
      });
      return component;
    });
  }

  /**
   * Remove o componente da página. Se ele não aparece em nenhuma outra página,
   * é excluído (com seu histórico).
   */
  async remove(pageId: string, componentId: string, audit: AuditContext): Promise<void> {
    const before = await this.findLink(pageId, componentId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.pageComponent.delete({ where: { pageId_componentId: { pageId, componentId } } });
      const remaining = await tx.pageComponent.count({ where: { componentId } });
      if (remaining === 0) await tx.component.delete({ where: { id: componentId } });
      await recordAudit(tx, {
        ...audit,
        action: remaining === 0 ? 'component.delete' : 'component.detach',
        entityType: 'component',
        entityId: componentId,
        pageId,
        before,
      });
    });
  }

  async setStatus(
    pageId: string,
    componentId: string,
    status: ComponentStatus,
    audit: AuditContext,
  ) {
    const link = await this.findLink(pageId, componentId);
    return this.prisma.client.$transaction(async (tx) => {
      const applied = await setComponentStatuses(tx, [{ componentId, status }], {
        actorId: audit.actorId,
      });
      if (applied.length > 0) {
        await recordAudit(tx, {
          ...audit,
          action: 'component.status_change',
          entityType: 'component',
          entityId: componentId,
          pageId,
          before: { status: link.component.status },
          after: { status },
        });
      }
      return { id: componentId, status };
    });
  }

  /** Reordena grupos e componentes (e move componentes entre grupos). */
  async setLayout(pageId: string, layout: LayoutInput, audit: AuditContext): Promise<void> {
    const [groups, links] = await Promise.all([
      this.prisma.client.componentGroup.findMany({ where: { pageId }, select: { id: true } }),
      this.prisma.client.pageComponent.findMany({
        where: { pageId },
        select: { componentId: true },
      }),
    ]);
    const groupIds = new Set(groups.map((g) => g.id));
    const componentIds = new Set(links.map((l) => l.componentId));
    const sameSet = (a: Set<string>, b: string[]) =>
      a.size === b.length && b.every((id) => a.has(id));
    if (
      !sameSet(groupIds, layout.groups) ||
      !sameSet(
        componentIds,
        layout.components.map((c) => c.componentId),
      ) ||
      layout.components.some((c) => c.groupId !== null && !groupIds.has(c.groupId))
    ) {
      throw new BadRequestException({ message: 'layout_mismatch' });
    }

    await this.prisma.client.$transaction(async (tx) => {
      for (const [position, id] of layout.groups.entries()) {
        await tx.componentGroup.update({ where: { id }, data: { position } });
      }
      for (const [position, { componentId, groupId }] of layout.components.entries()) {
        await tx.pageComponent.update({
          where: { pageId_componentId: { pageId, componentId } },
          data: { position, groupId },
        });
      }
      await recordAudit(tx, {
        ...audit,
        action: 'page.layout_update',
        entityType: 'page',
        entityId: pageId,
        pageId,
        after: layout,
      });
    });
  }

  private async findGroup(pageId: string, groupId: string) {
    const group = await this.prisma.client.componentGroup.findFirst({
      where: { id: groupId, pageId },
    });
    if (!group) throw new NotFoundException({ message: 'group_not_found' });
    return group;
  }

  private async findLink(pageId: string, componentId: string) {
    const link = await this.prisma.client.pageComponent.findUnique({
      where: { pageId_componentId: { pageId, componentId } },
      include: { component: true },
    });
    if (!link) throw new NotFoundException({ message: 'component_not_found' });
    return link;
  }
}
