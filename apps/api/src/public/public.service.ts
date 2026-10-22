import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  computeUptime,
  localDate,
  startOfLocalDay,
  renderMarkdown,
  type StatusPoint,
} from '@status-page/core';
import { type Page } from '@status-page/db';
import {
  type ComponentStatus,
  type MetricRange,
  overallStatus,
  roleAtLeast,
} from '@status-page/shared';
import { assertCanView } from '../access/page-access.js';
import { type AuthContext, effectiveRole } from '../common/auth.types.js';
import { PrismaService } from '../infra/prisma.service.js';
import { metricSeries } from '../monitoring/metrics.js';
import { PagesService } from '../pages/pages.service.js';
import { ThemeService } from '../theme/theme.service.js';

/** Quem está pedindo a página: sessão (se houver) e IP de origem. */
export interface Viewer {
  auth?: AuthContext;
  ip?: string | null;
  /** Pré-visualizar o rascunho do tema (só para Admins da página). */
  preview?: boolean;
}

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
    private readonly themes: ThemeService,
  ) {}

  /** Slug da página padrão. Se for privada, o acesso é checado ao abri-la. */
  async defaultSlug(): Promise<string | null> {
    const id = await this.pages.defaultPageId();
    if (!id) return null;
    const page = await this.prisma.client.page.findUnique({ where: { id } });
    return page?.slug ?? null;
  }

  async summary(slug: string, viewer: Viewer, now = new Date()) {
    const page = await this.findPage(slug, viewer);
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
      page: await this.publicPage(page, viewer),
      status: overallStatus(components.map((c) => c.status)),
      groups: groups.map((g) => ({ id: g.id, name: g.name, collapsed: g.collapsed })),
      components,
      activeIncidents,
      maintenances,
      pastIncidents,
      pastIncidentDays: PAST_INCIDENT_DAYS,
      /** Há monitores com métricas públicas (exibe a seção de desempenho). */
      hasMetrics:
        (await this.prisma.client.monitor.count({
          where: { pageId: page.id, publicMetrics: true, componentId: { not: null } },
        })) > 0,
      generatedAt: now,
    };
  }

  async incident(slug: string, incidentId: string, viewer: Viewer) {
    const page = await this.findPage(slug, viewer);
    const incident = await this.prisma.client.incident.findFirst({
      where: { id: incidentId, pageId: page.id },
      select: this.incidentSelect(),
    });
    if (!incident) throw new NotFoundException({ message: 'incident_not_found' });
    const postmortem = await this.prisma.client.postmortem.findFirst({
      where: { incidentId, publishedAt: { not: null } },
      select: { body: true, publishedAt: true },
    });
    return {
      page: await this.publicPage(page, viewer),
      incident: {
        ...incident,
        postmortem: postmortem
          ? { html: renderMarkdown(postmortem.body), publishedAt: postmortem.publishedAt }
          : null,
      },
    };
  }

  /** Latência e disponibilidade dos monitores marcados como públicos. */
  async metrics(slug: string, range: MetricRange, viewer: Viewer) {
    const page = await this.findPage(slug, viewer);
    const monitors = await this.prisma.client.monitor.findMany({
      where: {
        pageId: page.id,
        publicMetrics: true,
        component: { pages: { some: { pageId: page.id } } },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true, component: { select: { id: true, name: true } } },
    });
    const series = await metricSeries(
      this.prisma.client,
      monitors.map((m) => m.id),
      range,
    );
    return {
      page: await this.publicPage(page, viewer),
      range,
      monitors: monitors.map((m) => ({
        id: m.id,
        name: m.name,
        type: m.type,
        component: m.component,
        ...series.get(m.id)!,
      })),
    };
  }

  async maintenance(slug: string, maintenanceId: string, viewer: Viewer) {
    const page = await this.findPage(slug, viewer);
    const maintenance = await this.prisma.client.maintenance.findFirst({
      where: { id: maintenanceId, pageId: page.id },
      select: this.maintenanceSelect(),
    });
    if (!maintenance) throw new NotFoundException({ message: 'maintenance_not_found' });
    return { page: await this.publicPage(page, viewer), maintenance };
  }

  /** Incidentes e manutenções concluídas de um mês (no fuso da página). */
  async history(slug: string, month: string, viewer: Viewer) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException({ message: 'invalid_month' });
    }
    const page = await this.findPage(slug, viewer);
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
    return { page: await this.publicPage(page, viewer), month, incidents, maintenances };
  }

  /** Busca a página e aplica as regras de acesso (públicas, login e/ou IP). */
  async findPage(slug: string, viewer: Viewer): Promise<Page> {
    const page = await this.prisma.client.page.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException({ message: 'page_not_found' });
    assertCanView(page, viewer.auth, viewer.ip);
    return page;
  }

  private async publicPage(page: Page, viewer: Viewer) {
    const role = viewer.auth ? effectiveRole(viewer.auth, page.id) : undefined;
    const preview = Boolean(viewer.preview && role && roleAtLeast(role, 'admin'));
    return {
      slug: page.slug,
      name: page.name,
      description: page.description,
      timezone: page.timezone,
      defaultLocale: page.defaultLocale,
      visibility: page.visibility,
      preview,
      theme: await this.themes.forDisplay(page.id, preview ? 'draft' : 'published'),
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
