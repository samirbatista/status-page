import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  computeUptime,
  localDate,
  startOfLocalDay,
  type StatusPoint,
} from '@status-page/core';
import { type ComponentStatus, overallStatus } from '@status-page/shared';
import { PrismaService } from '../infra/prisma.service.js';
import { PagesService } from '../pages/pages.service.js';

export const UPTIME_DAYS = 90;
const PAST_INCIDENT_DAYS = 14;

const PUBLIC_UPDATE_SELECT = {
  id: true,
  status: true,
  body: true,
  displayAt: true,
  components: { select: { status: true, component: { select: { id: true, name: true } } } },
} as const;

/**
 * Dados da página pública. Só expõe páginas públicas e nunca dados internos
 * (autores, flags de notificação, IDs de usuário).
 */
@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pages: PagesService,
  ) {}

  async defaultSlug(): Promise<string | null> {
    const id = await this.pages.defaultPageId();
    if (!id) return null;
    const page = await this.prisma.client.page.findUnique({ where: { id } });
    return page?.visibility === 'public' ? page.slug : null;
  }

  async summary(slug: string, now = new Date()) {
    const page = await this.findPage(slug);
    const [groups, links, activeIncidents, maintenances, pastIncidents] = await Promise.all([
      this.prisma.client.componentGroup.findMany({
        where: { pageId: page.id },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.client.pageComponent.findMany({
        where: { pageId: page.id },
        orderBy: { position: 'asc' },
        include: { component: true },
      }),
      this.prisma.client.incident.findMany({
        where: { pageId: page.id, status: { not: 'resolved' } },
        orderBy: { startedAt: 'desc' },
        select: this.incidentSelect(),
      }),
      this.prisma.client.maintenance.findMany({
        where: { pageId: page.id, status: { in: ['scheduled', 'in_progress'] } },
        orderBy: { scheduledStart: 'asc' },
        select: this.maintenanceSelect(),
      }),
      this.prisma.client.incident.findMany({
        where: {
          pageId: page.id,
          status: 'resolved',
          startedAt: {
            gte: startOfLocalDay(
              addDays(localDate(now, page.timezone), -(PAST_INCIDENT_DAYS - 1)),
              page.timezone,
            ),
          },
        },
        orderBy: { startedAt: 'desc' },
        select: this.incidentSelect(),
      }),
    ]);

    const uptime = await this.uptimeFor(
      links.filter((l) => l.showUptime).map((l) => l.componentId),
      page.timezone,
      now,
    );
    const components = links.map(({ component, groupId, showUptime }) => ({
      id: component.id,
      name: component.name,
      description: component.description,
      status: component.status,
      groupId,
      uptime: showUptime ? (uptime.get(component.id) ?? null) : null,
    }));

    return {
      page: this.publicPage(page),
      status: overallStatus(components.map((c) => c.status)),
      groups: groups.map((g) => ({ id: g.id, name: g.name, collapsed: g.collapsed })),
      components,
      activeIncidents,
      maintenances,
      pastIncidents,
      pastIncidentDays: PAST_INCIDENT_DAYS,
      generatedAt: now,
    };
  }

  async incident(slug: string, incidentId: string) {
    const page = await this.findPage(slug);
    const incident = await this.prisma.client.incident.findFirst({
      where: { id: incidentId, pageId: page.id },
      select: this.incidentSelect(),
    });
    if (!incident) throw new NotFoundException({ message: 'incident_not_found' });
    return { page: this.publicPage(page), incident };
  }

  async maintenance(slug: string, maintenanceId: string) {
    const page = await this.findPage(slug);
    const maintenance = await this.prisma.client.maintenance.findFirst({
      where: { id: maintenanceId, pageId: page.id },
      select: this.maintenanceSelect(),
    });
    if (!maintenance) throw new NotFoundException({ message: 'maintenance_not_found' });
    return { page: this.publicPage(page), maintenance };
  }

  /** Incidentes e manutenções concluídas de um mês (no fuso da página). */
  async history(slug: string, month: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException({ message: 'invalid_month' });
    }
    const page = await this.findPage(slug);
    const from = startOfLocalDay(`${month}-01`, page.timezone);
    const [y, m] = month.split('-').map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const to = startOfLocalDay(next, page.timezone);

    const [incidents, maintenances] = await Promise.all([
      this.prisma.client.incident.findMany({
        where: { pageId: page.id, startedAt: { gte: from, lt: to } },
        orderBy: { startedAt: 'desc' },
        select: this.incidentSelect(),
      }),
      this.prisma.client.maintenance.findMany({
        where: { pageId: page.id, status: 'completed', scheduledStart: { gte: from, lt: to } },
        orderBy: { scheduledStart: 'desc' },
        select: this.maintenanceSelect(),
      }),
    ]);
    return { page: this.publicPage(page), month, incidents, maintenances };
  }

  private async findPage(slug: string) {
    const page = await this.prisma.client.page.findUnique({ where: { slug } });
    // Páginas privadas ficam invisíveis até a F2 (login de leitor / lista de IPs).
    if (!page || page.visibility !== 'public')
      throw new NotFoundException({ message: 'page_not_found' });
    return page;
  }

  private publicPage(page: {
    slug: string;
    name: string;
    description: string | null;
    timezone: string;
    defaultLocale: string;
  }) {
    return {
      slug: page.slug,
      name: page.name,
      description: page.description,
      timezone: page.timezone,
      defaultLocale: page.defaultLocale,
    };
  }

  private incidentSelect() {
    return {
      id: true,
      title: true,
      status: true,
      impact: true,
      startedAt: true,
      resolvedAt: true,
      updates: { orderBy: { displayAt: 'desc' }, select: PUBLIC_UPDATE_SELECT },
    } as const;
  }

  private maintenanceSelect() {
    return {
      id: true,
      title: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      startedAt: true,
      completedAt: true,
      components: { select: { component: { select: { id: true, name: true } } } },
      updates: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, body: true, createdAt: true },
      },
    } as const;
  }

  /** Uptime de 90 dias por componente, a partir do histórico de status. */
  private async uptimeFor(componentIds: string[], timeZone: string, now: Date) {
    const result = new Map<string, ReturnType<typeof computeUptime>>();
    if (componentIds.length === 0) return result;
    const windowStart = startOfLocalDay(
      addDays(localDate(now, timeZone), -(UPTIME_DAYS - 1)),
      timeZone,
    );

    const [inWindow, before] = await Promise.all([
      this.prisma.client.componentStatusHistory.findMany({
        where: { componentId: { in: componentIds }, changedAt: { gte: windowStart, lte: now } },
        orderBy: { changedAt: 'asc' },
        select: { componentId: true, status: true, changedAt: true },
      }),
      // Último status antes da janela, para saber como cada componente começou.
      this.prisma.client.$queryRaw<
        { component_id: string; status: ComponentStatus; changed_at: Date }[]
      >`
        SELECT DISTINCT ON (component_id) component_id, status, changed_at
        FROM component_status_history
        WHERE component_id = ANY(${componentIds}::uuid[]) AND changed_at < ${windowStart}
        ORDER BY component_id, changed_at DESC
      `,
    ]);

    const byComponent = new Map<string, StatusPoint[]>(componentIds.map((id) => [id, []]));
    for (const row of before) {
      byComponent.get(row.component_id)?.push({ status: row.status, changedAt: row.changed_at });
    }
    for (const row of inWindow) {
      byComponent.get(row.componentId)?.push({ status: row.status, changedAt: row.changedAt });
    }
    for (const [id, history] of byComponent) {
      result.set(id, computeUptime({ history, days: UPTIME_DAYS, timeZone, now }));
    }
    return result;
  }
}
