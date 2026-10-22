import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { type AuditContext, PasswordBox, recordAudit } from '@status-page/core';
import { API_ENV, type ApiEnv } from '../env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SecretsService } from '../infra/secrets.service.js';
import { APP_VERSION } from '../version.js';
import { CONFIG_FORMAT, CONFIG_VERSION, type ConfigFile, type ConfigPage } from './format.js';

/**
 * Exporta a configuração (páginas, temas e arquivos, componentes, grupos,
 * templates, mensagens, canais, monitores, integrações e LDAP) em JSON
 * versionado. Histórico de incidentes e assinantes ficam de fora (dados
 * pessoais; têm exportação própria).
 */
@Injectable()
export class ConfigExportService {
  private readonly uploadDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.uploadDir = resolve(env.UPLOAD_DIR);
  }

  async export(
    options: { pageIds: string[]; password: string | null; includeLdap: boolean },
    audit: AuditContext,
  ): Promise<ConfigFile> {
    const box = options.password ? await PasswordBox.create(options.password) : null;
    /** Segredo guardado (cifrado com o APP_SECRET) → cifrado com a senha, ou `null`. */
    const reseal = (stored: string | null) =>
      box && stored ? box.encrypt(this.secrets.decrypt(stored)) : null;

    const pages = await this.prisma.client.page.findMany({
      where: options.pageIds.length ? { id: { in: options.pageIds } } : {},
      orderBy: { createdAt: 'asc' },
      include: {
        domains: { orderBy: { createdAt: 'asc' } },
        groups: { orderBy: { position: 'asc' } },
        components: { orderBy: { position: 'asc' }, include: { component: true } },
        themes: true,
        uploads: { orderBy: { createdAt: 'asc' } },
        templates: { orderBy: { name: 'asc' } },
        templatesNotify: true,
        channels: { orderBy: { createdAt: 'asc' } },
        monitors: { orderBy: { name: 'asc' }, include: { template: { select: { name: true } } } },
        inboundSources: {
          orderBy: { name: 'asc' },
          include: {
            template: { select: { name: true } },
            rules: { orderBy: { position: 'asc' } },
          },
        },
      },
    });

    const components = new Map<string, { key: string; name: string; description: string | null }>();
    const exportedPages: ConfigPage[] = [];
    for (const page of pages) {
      for (const link of page.components) {
        components.set(link.componentId, {
          key: link.componentId,
          name: link.component.name,
          description: link.component.description,
        });
      }
      const linked = new Set(page.components.map((l) => l.componentId));
      const componentKey = (id: string | null) => (id && linked.has(id) ? id : null);

      const uploads = [];
      for (const upload of page.uploads) {
        const data = await readFile(join(this.uploadDir, upload.id)).catch(() => null);
        if (!data) continue;
        uploads.push({
          key: upload.id,
          kind: upload.kind,
          filename: upload.filename,
          data: data.toString('base64'),
        });
      }

      exportedPages.push({
        slug: page.slug,
        settings: {
          name: page.name,
          description: page.description,
          defaultLocale: page.defaultLocale,
          timezone: page.timezone,
          visibility: page.visibility,
          privateAccess: page.privateAccess,
          allowedCidrs: page.allowedCidrs,
        },
        domains: page.domains.map((d) => d.hostname),
        groups: page.groups.map((g) => ({
          key: g.id,
          name: g.name,
          position: g.position,
          collapsed: g.collapsed,
        })),
        components: page.components.map((l) => ({
          component: l.componentId,
          group: l.groupId,
          position: l.position,
          showUptime: l.showUptime,
        })),
        themes: page.themes.map((t) => ({
          kind: t.kind,
          data: t.data as Record<string, unknown>,
        })),
        uploads,
        templates: page.templates.map((t) => ({
          name: t.name,
          title: t.title,
          body: t.body,
          status: t.status,
          impact: t.impact,
          components: t.componentIds.filter((id) => linked.has(id)),
          componentStatus: t.componentStatus,
        })),
        notificationTemplates: page.templatesNotify.map((t) => ({
          channel: t.channel,
          event: t.event,
          locale: t.locale,
          subject: t.subject,
          body: t.body,
        })),
        channels: page.channels.map((c) => ({
          kind: c.kind,
          name: c.name,
          enabled: c.enabled,
          events: c.events,
          locale: c.locale,
          config: reseal(c.configEnc),
        })),
        monitors: page.monitors.map((m) => ({
          name: m.name,
          type: m.type,
          target: m.target,
          config: m.config,
          component: componentKey(m.componentId),
          template: m.template?.name ?? null,
          intervalSeconds: m.intervalSeconds,
          timeoutMs: m.timeoutMs,
          failureThreshold: m.failureThreshold,
          recoveryThreshold: m.recoveryThreshold,
          mode: m.mode,
          failureStatus: m.failureStatus,
          publicMetrics: m.publicMetrics,
          enabled: m.enabled,
          headers: reseal(m.headersEnc),
        })),
        inboundSources: page.inboundSources.map((s) => ({
          name: s.name,
          kind: s.kind,
          mode: s.mode,
          template: s.template?.name ?? null,
          enabled: s.enabled,
          mapping: s.mapping,
          hmacSecret: reseal(s.hmacSecretEnc),
          rules: s.rules
            .filter((r) => linked.has(r.componentId))
            .map((r) => ({
              matchField: r.matchField,
              pattern: r.pattern,
              component: r.componentId,
              status: r.status,
            })),
        })),
      });
    }

    const slugs = new Map(pages.map((p) => [p.id, p.slug]));
    const ldapProviders = options.includeLdap
      ? await this.prisma.client.ldapProvider.findMany({
          orderBy: { position: 'asc' },
          include: { mappings: true },
        })
      : [];

    const file: ConfigFile = {
      format: CONFIG_FORMAT,
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      secrets: box ? box.params : null,
      components: [...components.values()],
      pages: exportedPages,
      ldapProviders: ldapProviders.map((p) => ({
        name: p.name,
        kind: p.kind,
        enabled: p.enabled,
        host: p.host,
        port: p.port,
        security: p.security,
        verifyCertificate: p.verifyCertificate,
        caCertificate: p.caCertificate,
        bindDn: p.bindDn,
        baseDn: p.baseDn,
        userFilter: p.userFilter,
        usernameAttribute: p.usernameAttribute,
        emailAttribute: p.emailAttribute,
        nameAttribute: p.nameAttribute,
        uniqueIdAttribute: p.uniqueIdAttribute,
        nestedGroups: p.nestedGroups,
        groupBaseDn: p.groupBaseDn,
        groupFilter: p.groupFilter,
        manualRolesWin: p.manualRolesWin,
        linkByEmail: p.linkByEmail,
        timeoutMs: p.timeoutMs,
        bindPassword: reseal(p.bindPasswordEnc),
        // Mapeamentos de páginas fora da exportação não são levados.
        mappings: p.mappings
          .filter((m) => m.pageId === null || slugs.has(m.pageId))
          .map((m) => ({
            groupDn: m.groupDn,
            page: m.pageId ? slugs.get(m.pageId)! : null,
            role: m.role,
          })),
      })),
    };

    await recordAudit(this.prisma.client, {
      ...audit,
      action: 'config.export',
      entityType: 'installation',
      after: {
        pages: exportedPages.map((p) => p.slug),
        withSecrets: Boolean(box),
        ldapProviders: file.ldapProviders.length,
      },
    });
    return file;
  }

  /** Histórico de incidentes e manutenções de uma página (exportação separada). */
  async history(pageId: string) {
    const page = await this.prisma.client.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { slug: true, name: true, timezone: true },
    });
    const [incidents, maintenances] = await Promise.all([
      this.prisma.client.incident.findMany({
        where: { pageId },
        orderBy: { startedAt: 'asc' },
        select: {
          id: true,
          title: true,
          status: true,
          impact: true,
          startedAt: true,
          resolvedAt: true,
          backfilled: true,
          updates: {
            orderBy: { displayAt: 'asc' },
            select: {
              status: true,
              body: true,
              displayAt: true,
              components: { select: { status: true, component: { select: { name: true } } } },
            },
          },
          postmortem: { select: { body: true, publishedAt: true } },
        },
      }),
      this.prisma.client.maintenance.findMany({
        where: { pageId },
        orderBy: { scheduledStart: 'asc' },
        select: {
          id: true,
          title: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          startedAt: true,
          completedAt: true,
          components: { select: { component: { select: { name: true } } } },
          updates: {
            orderBy: { createdAt: 'asc' },
            select: { status: true, body: true, createdAt: true },
          },
        },
      }),
    ]);
    return {
      format: 'status-page-history',
      version: 1,
      exportedAt: new Date().toISOString(),
      page,
      incidents,
      maintenances,
    };
  }
}
