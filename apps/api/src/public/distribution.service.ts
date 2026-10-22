import { Injectable, NotFoundException } from '@nestjs/common';
import { type Page } from '@status-page/db';
import { messages } from '@status-page/i18n';
import { pageBaseUrl } from '@status-page/notifiers';
import { type ComponentStatus, isLocale, type Locale, overallStatus } from '@status-page/shared';
import { NotifyService } from '../infra/notify.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { PublicService, type Viewer } from './public.service.js';

/**
 * Formas de levar o status para fora da página: JSON compacto, feeds RSS/Atom,
 * selo SVG e widget. Seguem a mesma regra de acesso da página.
 */

const FEED_LIMIT = 50;

/** Cores padrão dos status (as mesmas do tema padrão). */
export const STATUS_COLORS: Record<ComponentStatus, string> = {
  operational: '#1a7f37',
  under_maintenance: '#0969da',
  degraded_performance: '#bf8700',
  partial_outage: '#d4610b',
  major_outage: '#cf222e',
};

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  published: Date;
  updated: Date;
  html: string;
}

@Injectable()
export class DistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicData: PublicService,
    private readonly notify: NotifyService,
  ) {}

  locale(page: Page, requested?: string): Locale {
    if (requested && isLocale(requested)) return requested;
    return isLocale(page.defaultLocale) ? page.defaultLocale : 'pt-BR';
  }

  baseUrl(page: Page) {
    return pageBaseUrl(this.prisma.client, page, this.notify.env.publicUrl);
  }

  /** Status atual em JSON compacto (integrações, scripts e o widget). */
  async status(slug: string, viewer: Viewer) {
    const page = await this.publicData.findPage(slug, viewer);
    const [links, incidents, maintenances, url] = await Promise.all([
      this.prisma.client.pageComponent.findMany({
        where: { pageId: page.id },
        orderBy: { position: 'asc' },
        include: { component: true, group: { select: { name: true } } },
      }),
      this.prisma.client.incident.findMany({
        where: { pageId: page.id, status: { not: 'resolved' } },
        orderBy: { startedAt: 'desc' },
        select: { id: true, title: true, status: true, impact: true, startedAt: true },
      }),
      this.prisma.client.maintenance.findMany({
        where: { pageId: page.id, status: { in: ['scheduled', 'in_progress'] } },
        orderBy: { scheduledStart: 'asc' },
        select: {
          id: true,
          title: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
        },
      }),
      this.baseUrl(page),
    ]);
    const components = links.map((l) => ({
      id: l.component.id,
      name: l.component.name,
      group: l.group?.name ?? null,
      status: l.component.status,
    }));
    return {
      page: {
        slug: page.slug,
        name: page.name,
        url,
        visibility: page.visibility,
      },
      status: overallStatus(components.map((c) => c.status)),
      components,
      incidents: incidents.map((i) => ({ ...i, url: `${url}/incidents/${i.id}` })),
      maintenances: maintenances.map((m) => ({ ...m, url: `${url}/maintenances/${m.id}` })),
      updatedAt: new Date(),
    };
  }

  /** Incidentes e manutenções recentes, para os feeds. */
  async feed(slug: string, viewer: Viewer, lang?: string) {
    const page = await this.publicData.findPage(slug, viewer);
    const locale = this.locale(page, lang);
    const t = messages[locale];
    const url = await this.baseUrl(page);
    const [incidents, maintenances] = await Promise.all([
      this.prisma.client.incident.findMany({
        where: { pageId: page.id },
        orderBy: { startedAt: 'desc' },
        take: FEED_LIMIT,
        include: { updates: { orderBy: { displayAt: 'desc' } } },
      }),
      this.prisma.client.maintenance.findMany({
        where: { pageId: page.id },
        orderBy: { scheduledStart: 'desc' },
        take: FEED_LIMIT,
        include: { updates: { orderBy: { createdAt: 'desc' } } },
      }),
    ]);
    const date = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: page.timezone,
    });
    const items: FeedItem[] = [
      ...incidents.map((i) => ({
        id: `urn:uuid:${i.id}`,
        title: `[${t.incident[i.status]}] ${i.title}`,
        url: `${url}/incidents/${i.id}`,
        published: i.startedAt,
        updated: i.updates[0]?.displayAt ?? i.startedAt,
        html: i.updates
          .map(
            (u) =>
              `<p><strong>${escapeXml(t.incident[u.status])}</strong> — ${escapeXml(
                date.format(u.displayAt),
              )}<br>${escapeXml(u.body).replace(/\n/g, '<br>')}</p>`,
          )
          .join(''),
      })),
      ...maintenances.map((m) => ({
        id: `urn:uuid:${m.id}`,
        title: `[${t.maintenance.status[m.status]}] ${m.title}`,
        url: `${url}/maintenances/${m.id}`,
        published: m.createdAt,
        updated: m.updates[0]?.createdAt ?? m.updatedAt,
        html:
          `<p>${escapeXml(date.format(m.scheduledStart))} – ${escapeXml(date.format(m.scheduledEnd))}</p>` +
          m.updates
            .map(
              (u) =>
                `<p><strong>${escapeXml(t.maintenance.status[u.status])}</strong><br>${escapeXml(
                  u.body,
                ).replace(/\n/g, '<br>')}</p>`,
            )
            .join(''),
      })),
    ]
      .sort((a, b) => b.updated.getTime() - a.updated.getTime())
      .slice(0, FEED_LIMIT);
    const self = `${this.notify.env.publicUrl.replace(/\/$/, '')}/api/public/pages/${page.slug}`;
    return {
      page,
      locale,
      title: t.distribution.feedTitle.replace('{page}', page.name),
      url,
      self,
      items,
    };
  }

  atom(feed: Awaited<ReturnType<DistributionService['feed']>>): string {
    const updated = (feed.items[0]?.updated ?? new Date()).toISOString();
    const entries = feed.items
      .map(
        (item) => `  <entry>
    <id>${item.id}</id>
    <title>${escapeXml(item.title)}</title>
    <link rel="alternate" href="${escapeXml(item.url)}"/>
    <published>${item.published.toISOString()}</published>
    <updated>${item.updated.toISOString()}</updated>
    <content type="html">${escapeXml(item.html)}</content>
  </entry>`,
      )
      .join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${feed.locale}">
  <id>urn:uuid:${feed.page.id}</id>
  <title>${escapeXml(feed.title)}</title>
  <link rel="alternate" href="${escapeXml(feed.url)}"/>
  <link rel="self" href="${escapeXml(`${feed.self}/feed.atom`)}"/>
  <updated>${updated}</updated>
${entries}
</feed>
`;
  }

  rss(feed: Awaited<ReturnType<DistributionService['feed']>>): string {
    const items = feed.items
      .map(
        (item) => `    <item>
      <guid isPermaLink="false">${item.id}</guid>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.url)}</link>
      <pubDate>${item.updated.toUTCString()}</pubDate>
      <description>${escapeXml(item.html)}</description>
    </item>`,
      )
      .join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <link>${escapeXml(feed.url)}</link>
    <description>${escapeXml(feed.title)}</description>
    <language>${feed.locale}</language>
    <atom:link href="${escapeXml(`${feed.self}/feed.rss`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
  }

  /** Selo SVG no estilo "shields": rótulo à esquerda, status à direita. */
  async badge(slug: string, viewer: Viewer, lang?: string): Promise<{ page: Page; svg: string }> {
    const page = await this.publicData.findPage(slug, viewer);
    const statuses = await this.prisma.client.pageComponent.findMany({
      where: { pageId: page.id },
      select: { component: { select: { status: true } } },
    });
    const status = overallStatus(statuses.map((s) => s.component.status));
    const t = messages[this.locale(page, lang)];
    const label = t.distribution.badgeLabel;
    const value = t.status[status];
    // Largura aproximada (Verdana 11 px ≈ 6.5 px por caractere) + margens.
    const w = (s: string) => Math.round(s.length * 6.6 + 12);
    const lw = w(label);
    const vw = w(value);
    const color = STATUS_COLORS[status];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${escapeXml(`${label}: ${value}`)}">
  <title>${escapeXml(`${page.name}: ${value}`)}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${lw + vw}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${lw + vw}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14">${escapeXml(label)}</text>
    <text x="${lw + vw / 2}" y="14">${escapeXml(value)}</text>
  </g>
</svg>
`;
    return { page, svg };
  }

  /** Script que insere o mini painel (iframe) logo depois da própria tag. */
  async widget(slug: string, viewer: Viewer): Promise<{ page: Page; js: string }> {
    const page = await this.publicData.findPage(slug, viewer);
    // Widget é para sites externos: páginas privadas não são incorporáveis (o
    // acesso por IP passaria pela rede de quem visita o site de terceiros).
    if (page.visibility !== 'public') throw new NotFoundException({ message: 'page_not_found' });
    const js = `/* Status Page — widget. Uso: <script src=".../widget.js" data-lang="pt-BR" async></script> */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;
  var lang = script.getAttribute('data-lang');
  var frame = document.createElement('iframe');
  frame.src = origin + (lang ? '/' + encodeURIComponent(lang) : '') + '/p/' + ${JSON.stringify(encodeURIComponent(page.slug))} + '/embed';
  frame.title = ${JSON.stringify(page.name)};
  frame.loading = 'lazy';
  frame.style.cssText = 'border:0;width:100%;height:160px;max-width:640px;display:block';
  script.parentNode.insertBefore(frame, script.nextSibling);
  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    var data = event.data;
    if (data && data.type === 'status-page:height' && typeof data.height === 'number') {
      frame.style.height = Math.min(Math.max(data.height, 40), 2000) + 'px';
    }
  });
})();
`;
    return { page, js };
  }
}
