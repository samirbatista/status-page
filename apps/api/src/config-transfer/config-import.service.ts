import { createHash, randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  type AuditContext,
  InvalidCssError,
  InvalidPasswordError,
  isValidTimeZone,
  parseCidr,
  PasswordBox,
  recordAudit,
  releaseSignals,
  sanitizeCss,
  sanitizeHtml,
} from '@status-page/core';
import { type Prisma } from '@status-page/db';
import {
  channelConfigSchemas,
  channelCreateSchema,
  componentCreateSchema,
  domainCreateSchema,
  genericMappingSchema,
  groupCreateSchema,
  inboundRuleInputSchema,
  inboundSourceInputSchema,
  incidentTemplateSchema,
  ldapMappingCreateSchema,
  ldapProviderUpdateSchema,
  monitorConfigSchemas,
  monitorInputSchema,
  pageCreateSchema,
  pageUpdateSchema,
  templateUpsertSchema,
  themeSchema,
} from '@status-page/shared';
import { type z } from 'zod';
import { API_ENV, type ApiEnv } from '../env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SecretsService } from '../infra/secrets.service.js';
import { DEFAULT_PAGE_SETTING } from '../pages/pages.service.js';
import { detectFileType, isUnsafeSvg } from '../uploads/file-type.js';
import { MAX_UPLOAD_BYTES } from '../uploads/uploads.service.js';
import { type ConfigFile, type ConfigPage, configFileSchema, type ImportMode } from './format.js';

type Tx = Prisma.TransactionClient;

interface Counts {
  created: number;
  updated: number;
  deleted: number;
}
const ENTITIES = [
  'domains',
  'groups',
  'components',
  'uploads',
  'themes',
  'templates',
  'notificationTemplates',
  'channels',
  'monitors',
  'inboundSources',
] as const;
type Entity = (typeof ENTITIES)[number];

export interface PageReport {
  slug: string;
  action: 'create' | 'update';
  changes: Record<Entity, Counts>;
  /** Itens removidos (só no modo "substituir"). */
  removed: string[];
}

export interface ImportReport {
  mode: ImportMode;
  dryRun: boolean;
  withSecrets: boolean;
  pages: PageReport[];
  ldapProviders: Counts & { names: string[] };
  warnings: { scope: string; message: string; detail?: string }[];
}

/** Interrompe a transação da simulação, levando o relatório. */
class Rollback extends Error {
  constructor(readonly report: ImportReport) {
    super('rollback');
  }
}

const IMAGE_FIELDS = ['logoId', 'logoDarkId', 'faviconId', 'headerImageId', 'ogImageId'] as const;

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('; ');
}

/**
 * Importa um arquivo de configuração. A simulação (`dryRun`) roda exatamente o
 * mesmo código dentro de uma transação desfeita no final: o relatório mostra o
 * que a importação faria. Cada entidade é validada com os mesmos schemas das
 * telas; o que não passa vira aviso e é ignorado.
 *
 * - **Mesclar**: cria o que falta e atualiza o que já existe (pelo nome); nada é apagado.
 * - **Substituir**: nas páginas do arquivo, também remove o que não está nele
 *   (grupos, vínculos de componentes, templates, mensagens, canais, monitores,
 *   integrações e domínios). Provedores LDAP nunca são removidos.
 */
@Injectable()
export class ConfigImportService {
  private readonly uploadDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.uploadDir = resolve(env.UPLOAD_DIR);
  }

  parse(raw: Buffer): ConfigFile {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException({ message: 'invalid_config_file' });
    }
    const result = configFileSchema.safeParse(json);
    if (!result.success) {
      throw new BadRequestException({
        message: 'invalid_config_file',
        detail: issues(result.error),
      });
    }
    return result.data;
  }

  async import(
    file: ConfigFile,
    options: { mode: ImportMode; password: string | null; dryRun: boolean },
    audit: AuditContext,
  ): Promise<ImportReport> {
    let box: PasswordBox | null = null;
    if (file.secrets && options.password) {
      box = PasswordBox.open(options.password, file.secrets);
      const sample = this.firstSecret(file);
      try {
        if (sample) box.decrypt(sample);
      } catch (error) {
        if (error instanceof InvalidPasswordError) {
          throw new BadRequestException({ message: 'invalid_password' });
        }
        throw error;
      }
    }

    const report: ImportReport = {
      mode: options.mode,
      dryRun: options.dryRun,
      withSecrets: Boolean(box),
      pages: [],
      ldapProviders: { created: 0, updated: 0, deleted: 0, names: [] },
      warnings: [],
    };
    if (file.secrets && !box) {
      report.warnings.push({ scope: 'secrets', message: 'secrets_not_imported' });
    }
    const written: string[] = [];
    const run = new ImportRun(this.secrets, box, options.mode, report, (id, data) =>
      this.writeUpload(id, data, options.dryRun, written),
    );

    try {
      await this.prisma.client.$transaction(
        async (tx) => {
          const componentIds = new Map<string, string>();
          for (const page of file.pages) await run.page(tx, file, page, componentIds);
          await run.ldap(tx, file);
          await recordAudit(tx, {
            ...audit,
            action: 'config.import',
            entityType: 'installation',
            after: {
              mode: options.mode,
              pages: report.pages.map((p) => `${p.slug}:${p.action}`),
              warnings: report.warnings.length,
            },
          });
          if (options.dryRun) throw new Rollback(report);
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (error) {
      if (error instanceof Rollback) return error.report;
      await Promise.all(written.map((id) => rm(join(this.uploadDir, id), { force: true })));
      throw error;
    }
    return report;
  }

  private async writeUpload(id: string, data: Buffer, dryRun: boolean, written: string[]) {
    if (dryRun) return;
    await writeFile(join(this.uploadDir, id), data, { mode: 0o640 });
    written.push(id);
  }

  private firstSecret(file: ConfigFile): string | null {
    for (const page of file.pages) {
      for (const list of [page.channels, page.monitors, page.inboundSources]) {
        for (const item of list) {
          const value =
            (item as { config?: string | null }).config ??
            (item as { headers?: string | null }).headers ??
            (item as { hmacSecret?: string | null }).hmacSecret;
          if (value) return value;
        }
      }
    }
    return file.ldapProviders.find((p) => p.bindPassword)?.bindPassword ?? null;
  }
}

/** Estado de uma importação (mapas de chaves do arquivo → IDs do banco). */
class ImportRun {
  constructor(
    private readonly secrets: SecretsService,
    private readonly box: PasswordBox | null,
    private readonly mode: ImportMode,
    private readonly report: ImportReport,
    private readonly saveUpload: (id: string, data: Buffer) => Promise<void>,
  ) {}

  private unseal(value: string | null | undefined): string | null {
    return value && this.box ? this.box.decrypt(value) : null;
  }

  private warn(scope: string, message: string, detail?: string) {
    this.report.warnings.push({ scope, message, ...(detail ? { detail } : {}) });
  }

  async page(tx: Tx, file: ConfigFile, data: ConfigPage, componentIds: Map<string, string>) {
    const replace = this.mode === 'replace';
    // `null` no arquivo = campo vazio (os schemas das telas esperam ausência).
    const given = Object.fromEntries(
      Object.entries(data.settings).filter(([, value]) => value !== null),
    );
    const created = pageCreateSchema.safeParse({ slug: data.slug, ...given });
    const extra = pageUpdateSchema
      .pick({ privateAccess: true, allowedCidrs: true })
      .safeParse(data.settings);
    if (!created.success || !extra.success) {
      this.warn(
        `page:${data.slug}`,
        'invalid_page',
        created.success ? issues(extra.error!) : issues(created.error),
      );
      return;
    }
    if (!isValidTimeZone(created.data.timezone)) {
      this.warn(`page:${data.slug}`, 'invalid_timezone', created.data.timezone);
      return;
    }
    const cidrs = (extra.data.allowedCidrs ?? []).filter((c) => {
      const ok = Boolean(parseCidr(c));
      if (!ok) this.warn(`page:${data.slug}`, 'invalid_cidr', c);
      return ok;
    });
    const settings = {
      ...created.data,
      description: created.data.description ?? null,
      privateAccess: extra.data.privateAccess ?? 'login',
      allowedCidrs: cidrs,
    };

    const existing = await tx.page.findUnique({ where: { slug: settings.slug } });
    const page = existing
      ? await tx.page.update({ where: { id: existing.id }, data: settings })
      : await tx.page.create({ data: settings });
    if (!existing && !(await tx.setting.findUnique({ where: { key: DEFAULT_PAGE_SETTING } }))) {
      await tx.setting.create({ data: { key: DEFAULT_PAGE_SETTING, value: page.id } });
    }
    const counts = Object.fromEntries(
      ENTITIES.map((e) => [e, { created: 0, updated: 0, deleted: 0 }]),
    ) as Record<Entity, Counts>;
    const report: PageReport = {
      slug: page.slug,
      action: existing ? 'update' : 'create',
      changes: counts,
      removed: [],
    };
    this.report.pages.push(report);
    const scope = (what: string) => `page:${page.slug}:${what}`;

    // --- Domínios (importados sem verificação) ---
    const hostnames = new Set<string>();
    for (const raw of data.domains) {
      const parsed = domainCreateSchema.safeParse({ hostname: raw });
      if (!parsed.success) {
        this.warn(scope('domain'), 'invalid_domain', raw);
        continue;
      }
      const hostname = parsed.data.hostname;
      hostnames.add(hostname);
      const owner = await tx.pageDomain.findUnique({ where: { hostname } });
      if (owner && owner.pageId !== page.id) {
        this.warn(scope('domain'), 'domain_taken', hostname);
      } else if (!owner) {
        await tx.pageDomain.create({
          data: {
            pageId: page.id,
            hostname,
            verificationToken: randomBytes(16).toString('hex'),
          },
        });
        counts.domains.created++;
      }
    }
    if (replace) {
      const gone = await tx.pageDomain.findMany({
        where: { pageId: page.id, hostname: { notIn: [...hostnames] } },
      });
      for (const d of gone) {
        await tx.pageDomain.delete({ where: { id: d.id } });
        counts.domains.deleted++;
        report.removed.push(`domain:${d.hostname}`);
      }
    }

    // --- Grupos (pelo nome) ---
    const groupIds = new Map<string, string>();
    const keptGroups = new Set<string>();
    for (const g of data.groups) {
      const parsed = groupCreateSchema.safeParse({ name: g.name, collapsed: g.collapsed });
      if (!parsed.success) {
        this.warn(scope('group'), 'invalid_group', g.name);
        continue;
      }
      const found = await tx.componentGroup.findFirst({
        where: { pageId: page.id, name: parsed.data.name },
      });
      const row = found
        ? await tx.componentGroup.update({
            where: { id: found.id },
            data: { position: g.position, collapsed: parsed.data.collapsed },
          })
        : await tx.componentGroup.create({
            data: {
              pageId: page.id,
              name: parsed.data.name,
              position: g.position,
              collapsed: parsed.data.collapsed,
            },
          });
      counts.groups[found ? 'updated' : 'created']++;
      groupIds.set(g.key, row.id);
      keptGroups.add(row.id);
    }
    if (replace) {
      const gone = await tx.componentGroup.findMany({
        where: { pageId: page.id, id: { notIn: [...keptGroups] } },
      });
      for (const g of gone) {
        await tx.componentGroup.delete({ where: { id: g.id } });
        counts.groups.deleted++;
        report.removed.push(`group:${g.name}`);
      }
    }

    // --- Componentes (compartilhados pela chave; na página, pelo nome) ---
    const catalog = new Map(file.components.map((c) => [c.key, c]));
    const linked = new Set<string>();
    for (const link of data.components) {
      const source = catalog.get(link.component);
      const parsed = componentCreateSchema.safeParse({
        name: source?.name,
        description: source?.description ?? undefined,
      });
      if (!source || !parsed.success) {
        this.warn(scope('component'), 'invalid_component', source?.name ?? link.component);
        continue;
      }
      let componentId = componentIds.get(link.component);
      if (!componentId) {
        const found = await tx.pageComponent.findFirst({
          where: { pageId: page.id, component: { name: parsed.data.name } },
        });
        if (found) {
          componentId = found.componentId;
          await tx.component.update({
            where: { id: componentId },
            data: { description: parsed.data.description ?? null },
          });
          counts.components.updated++;
        } else {
          componentId = (
            await tx.component.create({
              data: { name: parsed.data.name, description: parsed.data.description ?? null },
            })
          ).id;
          counts.components.created++;
        }
        componentIds.set(link.component, componentId);
      }
      const groupId = link.group ? (groupIds.get(link.group) ?? null) : null;
      await tx.pageComponent.upsert({
        where: { pageId_componentId: { pageId: page.id, componentId } },
        create: {
          pageId: page.id,
          componentId,
          groupId,
          position: link.position,
          showUptime: link.showUptime,
        },
        update: { groupId, position: link.position, showUptime: link.showUptime },
      });
      linked.add(componentId);
    }
    const componentOf = (key: string | null | undefined) =>
      key ? (componentIds.get(key) ?? null) : null;
    if (replace) {
      const gone = await tx.pageComponent.findMany({
        where: { pageId: page.id, componentId: { notIn: [...linked] } },
        include: { component: { include: { _count: { select: { pages: true } } } } },
      });
      for (const link of gone) {
        await tx.pageComponent.delete({
          where: { pageId_componentId: { pageId: page.id, componentId: link.componentId } },
        });
        // Componente sem nenhuma outra página deixa de existir (com o histórico).
        if (link.component._count.pages <= 1) {
          await tx.component.delete({ where: { id: link.componentId } });
        }
        counts.components.deleted++;
        report.removed.push(`component:${link.component.name}`);
      }
    }

    // --- Arquivos e tema ---
    const uploadIds = new Map<string, string>();
    for (const upload of data.uploads) {
      const buffer = Buffer.from(upload.data, 'base64');
      const type = detectFileType(buffer);
      if (buffer.length > MAX_UPLOAD_BYTES || !type) {
        this.warn(scope('upload'), 'invalid_upload', upload.filename);
        continue;
      }
      if (type.contentType === 'image/svg+xml' && isUnsafeSvg(buffer)) {
        this.warn(scope('upload'), 'unsafe_svg', upload.filename);
        continue;
      }
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const same = await tx.upload.findFirst({ where: { pageId: page.id, sha256 } });
      if (same) {
        uploadIds.set(upload.key, same.id);
        continue;
      }
      const row = await tx.upload.create({
        data: {
          pageId: page.id,
          kind: type.kind,
          filename: upload.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'arquivo',
          contentType: type.contentType,
          size: buffer.length,
          sha256,
        },
      });
      await this.saveUpload(row.id, buffer);
      uploadIds.set(upload.key, row.id);
      counts.uploads.created++;
    }
    const pageUploads = new Set(
      (await tx.upload.findMany({ where: { pageId: page.id }, select: { id: true } })).map(
        (u) => u.id,
      ),
    );
    for (const theme of data.themes) {
      // As referências aos arquivos (campos e URLs no CSS/HTML) passam para os novos IDs.
      let json = JSON.stringify(theme.data);
      for (const [from, to] of uploadIds) json = json.split(from).join(to);
      const parsed = themeSchema.safeParse(JSON.parse(json));
      if (!parsed.success) {
        this.warn(scope('theme'), 'invalid_theme', issues(parsed.error));
        continue;
      }
      const value = { ...parsed.data, font: { ...parsed.data.font } };
      for (const field of IMAGE_FIELDS) {
        if (value[field] && !pageUploads.has(value[field])) value[field] = null;
      }
      if (value.font.uploadId && !pageUploads.has(value.font.uploadId)) {
        value.font.uploadId = null;
      }
      try {
        value.customCss = sanitizeCss(value.customCss).css;
      } catch (error) {
        if (!(error instanceof InvalidCssError)) throw error;
        this.warn(scope('theme'), 'invalid_css', error.reason);
        value.customCss = '';
      }
      value.customHeaderHtml = sanitizeHtml(value.customHeaderHtml);
      value.customFooterHtml = sanitizeHtml(value.customFooterHtml);
      const stored = value as unknown as Prisma.InputJsonValue;
      const found = await tx.pageTheme.findUnique({
        where: { pageId_kind: { pageId: page.id, kind: theme.kind } },
      });
      await tx.pageTheme.upsert({
        where: { pageId_kind: { pageId: page.id, kind: theme.kind } },
        create: { pageId: page.id, kind: theme.kind, data: stored },
        update: { data: stored },
      });
      counts.themes[found ? 'updated' : 'created']++;
    }

    // --- Templates de incidente (pelo nome) ---
    const templateIds = new Map<string, string>();
    for (const raw of data.templates) {
      const parsed = incidentTemplateSchema.safeParse({
        ...raw,
        componentIds: ((raw.components as string[] | undefined) ?? [])
          .map((k) => componentOf(k))
          .filter((id): id is string => Boolean(id)),
      });
      if (!parsed.success) {
        this.warn(scope('template'), 'invalid_template', issues(parsed.error));
        continue;
      }
      const found = await tx.incidentTemplate.findFirst({
        where: { pageId: page.id, name: parsed.data.name },
      });
      const row = found
        ? await tx.incidentTemplate.update({ where: { id: found.id }, data: parsed.data })
        : await tx.incidentTemplate.create({ data: { pageId: page.id, ...parsed.data } });
      counts.templates[found ? 'updated' : 'created']++;
      templateIds.set(row.name, row.id);
    }
    if (replace) {
      const gone = await tx.incidentTemplate.findMany({
        where: { pageId: page.id, id: { notIn: [...templateIds.values()] } },
      });
      for (const t of gone) {
        await tx.incidentTemplate.delete({ where: { id: t.id } });
        counts.templates.deleted++;
        report.removed.push(`template:${t.name}`);
      }
    }
    const templateOf = (name: unknown) =>
      typeof name === 'string' ? (templateIds.get(name) ?? null) : null;

    // --- Mensagens personalizadas ---
    const keptMessages: string[] = [];
    for (const raw of data.notificationTemplates) {
      const parsed = templateUpsertSchema.safeParse(raw);
      if (!parsed.success) {
        this.warn(scope('message'), 'invalid_message_template', issues(parsed.error));
        continue;
      }
      const { channel, event, locale, subject, body } = parsed.data;
      const where = { pageId_channel_event_locale: { pageId: page.id, channel, event, locale } };
      const found = await tx.notificationTemplate.findUnique({ where });
      const row = await tx.notificationTemplate.upsert({
        where,
        create: { pageId: page.id, channel, event, locale, subject, body },
        update: { subject, body },
      });
      keptMessages.push(row.id);
      counts.notificationTemplates[found ? 'updated' : 'created']++;
    }
    if (replace) {
      const { count } = await tx.notificationTemplate.deleteMany({
        where: { pageId: page.id, id: { notIn: keptMessages } },
      });
      counts.notificationTemplates.deleted += count;
    }

    // --- Canais da equipe (pelo nome; sem a senha, só os já existentes são atualizados) ---
    const keptChannels: string[] = [];
    for (const raw of data.channels) {
      const name = String(raw.name ?? '');
      const found = await tx.notificationChannel.findFirst({ where: { pageId: page.id, name } });
      const sealed = this.unseal(raw.config);
      let config: unknown = sealed ? JSON.parse(sealed) : null;
      if (config === null && found && found.kind === raw.kind) {
        config = JSON.parse(this.secrets.decrypt(found.configEnc));
      }
      if (config === null) {
        this.warn(scope('channel'), 'channel_needs_secrets', name);
        continue;
      }
      const parsed = channelCreateSchema.safeParse({ ...raw, config });
      if (!parsed.success) {
        this.warn(scope('channel'), 'invalid_channel', `${name}: ${issues(parsed.error)}`);
        continue;
      }
      const cfg = channelConfigSchemas[parsed.data.kind].parse(parsed.data.config);
      const values = {
        kind: parsed.data.kind,
        name: parsed.data.name,
        enabled: parsed.data.enabled,
        events: parsed.data.events,
        locale: parsed.data.locale,
        configEnc: this.secrets.encrypt(JSON.stringify(cfg)),
      };
      const row = found
        ? await tx.notificationChannel.update({ where: { id: found.id }, data: values })
        : await tx.notificationChannel.create({ data: { pageId: page.id, ...values } });
      keptChannels.push(row.id);
      counts.channels[found ? 'updated' : 'created']++;
    }
    if (replace) {
      const gone = await tx.notificationChannel.findMany({
        where: { pageId: page.id, id: { notIn: keptChannels } },
      });
      for (const c of gone) {
        await tx.notificationChannel.delete({ where: { id: c.id } });
        counts.channels.deleted++;
        report.removed.push(`channel:${c.name}`);
      }
    }

    // --- Monitores (pelo nome) ---
    const keptMonitors: string[] = [];
    for (const raw of data.monitors) {
      const headers = this.unseal(raw.headers);
      const parsed = monitorInputSchema.safeParse({
        ...raw,
        componentId: componentOf(raw.component as string | null),
        templateId: templateOf(raw.template),
        headers: headers ? (JSON.parse(headers) as Record<string, string>) : undefined,
      });
      if (!parsed.success) {
        this.warn(
          scope('monitor'),
          'invalid_monitor',
          `${String(raw.name)}: ${issues(parsed.error)}`,
        );
        continue;
      }
      const input = parsed.data;
      const found = await tx.monitor.findFirst({ where: { pageId: page.id, name: input.name } });
      const headersEnc =
        input.type !== 'http'
          ? null
          : input.headers && Object.keys(input.headers).length
            ? this.secrets.encrypt(JSON.stringify(input.headers))
            : (found?.headersEnc ?? null);
      const values = {
        name: input.name,
        type: input.type,
        target: input.target,
        config: monitorConfigSchemas[input.type].parse(input.config),
        componentId: input.componentId,
        templateId: input.templateId,
        intervalSeconds: input.intervalSeconds,
        timeoutMs: input.timeoutMs,
        failureThreshold: input.failureThreshold,
        recoveryThreshold: input.recoveryThreshold,
        mode: input.mode,
        failureStatus: input.failureStatus,
        publicMetrics: input.publicMetrics,
        enabled: input.enabled,
        headersEnc,
        nextCheckAt: new Date(),
      };
      let row;
      if (found) {
        const reset =
          !input.enabled ||
          found.componentId !== input.componentId ||
          found.type !== input.type ||
          found.target !== input.target;
        if (reset) await releaseSignals(tx, `monitor:${found.id}`);
        row = await tx.monitor.update({
          where: { id: found.id },
          data: {
            ...values,
            ...(reset ? { state: 'unknown', consecutiveFailures: 0, consecutiveSuccesses: 0 } : {}),
          },
        });
      } else {
        row = await tx.monitor.create({ data: { pageId: page.id, ...values } });
      }
      keptMonitors.push(row.id);
      counts.monitors[found ? 'updated' : 'created']++;
    }
    if (replace) {
      const gone = await tx.monitor.findMany({
        where: { pageId: page.id, id: { notIn: keptMonitors } },
      });
      for (const m of gone) {
        await releaseSignals(tx, `monitor:${m.id}`);
        await tx.monitor.delete({ where: { id: m.id } });
        counts.monitors.deleted++;
        report.removed.push(`monitor:${m.name}`);
      }
    }

    // --- Integrações de entrada (pelo nome; a URL/token é sempre nova) ---
    const keptSources: string[] = [];
    for (const raw of data.inboundSources) {
      const hmac = this.unseal(raw.hmacSecret);
      const parsed = inboundSourceInputSchema.safeParse({
        ...raw,
        templateId: templateOf(raw.template),
        hmacSecret: hmac ?? undefined,
        mapping: raw.mapping ?? undefined,
      });
      if (!parsed.success) {
        this.warn(
          scope('inbound'),
          'invalid_inbound_source',
          `${String(raw.name)}: ${issues(parsed.error)}`,
        );
        continue;
      }
      const input = parsed.data;
      const found = await tx.inboundSource.findFirst({
        where: { pageId: page.id, name: input.name },
      });
      if (found && found.kind !== input.kind) {
        this.warn(scope('inbound'), 'inbound_kind_mismatch', input.name);
        continue;
      }
      const values = {
        name: input.name,
        mode: input.mode,
        templateId: input.templateId,
        enabled: input.enabled,
        mapping: genericMappingSchema.parse(input.mapping ?? {}),
        hmacSecretEnc: input.hmacSecret
          ? this.secrets.encrypt(input.hmacSecret)
          : (found?.hmacSecretEnc ?? null),
      };
      let sourceId: string;
      if (found) {
        sourceId = (await tx.inboundSource.update({ where: { id: found.id }, data: values })).id;
        await tx.inboundRule.deleteMany({ where: { sourceId } });
      } else {
        const token = randomBytes(24).toString('base64url');
        sourceId = (
          await tx.inboundSource.create({
            data: {
              pageId: page.id,
              kind: input.kind,
              ...values,
              tokenEnc: this.secrets.encrypt(token),
              tokenHash: createHash('sha256').update(token).digest('hex'),
            },
          })
        ).id;
      }
      const rules = Array.isArray(raw.rules) ? (raw.rules as Record<string, unknown>[]) : [];
      let position = 0;
      for (const rule of rules) {
        const r = inboundRuleInputSchema.safeParse({
          ...rule,
          componentId: componentOf(rule.component as string),
        });
        if (!r.success) {
          this.warn(scope('inbound'), 'invalid_inbound_rule', `${input.name}: ${issues(r.error)}`);
          continue;
        }
        await tx.inboundRule.create({ data: { sourceId, position: position++, ...r.data } });
      }
      keptSources.push(sourceId);
      counts.inboundSources[found ? 'updated' : 'created']++;
    }
    if (replace) {
      const gone = await tx.inboundSource.findMany({
        where: { pageId: page.id, id: { notIn: keptSources } },
      });
      for (const s of gone) {
        await releaseSignals(tx, `inbound:${s.id}:`);
        await tx.inboundSource.delete({ where: { id: s.id } });
        counts.inboundSources.deleted++;
        report.removed.push(`inbound:${s.name}`);
      }
    }
  }

  /** Provedores LDAP (pelo nome) e mapeamentos de grupos. Nunca remove provedores. */
  async ldap(tx: Tx, file: ConfigFile) {
    for (const raw of file.ldapProviders) {
      const password = this.unseal(raw.bindPassword);
      const parsed = ldapProviderUpdateSchema.safeParse({ ...raw, bindPassword: password ?? '' });
      if (!parsed.success) {
        this.warn(`ldap:${String(raw.name)}`, 'invalid_ldap_provider', issues(parsed.error));
        continue;
      }
      const { bindPassword, ...fields } = parsed.data;
      const found = await tx.ldapProvider.findFirst({ where: { name: fields.name } });
      let providerId: string;
      if (found) {
        providerId = (
          await tx.ldapProvider.update({
            where: { id: found.id },
            data: {
              ...fields,
              ...(bindPassword ? { bindPasswordEnc: this.secrets.encrypt(bindPassword) } : {}),
            },
          })
        ).id;
        this.report.ldapProviders.updated++;
      } else {
        if (!bindPassword) {
          this.warn(`ldap:${fields.name}`, 'ldap_disabled_without_password');
        }
        const last = await tx.ldapProvider.aggregate({ _max: { position: true } });
        providerId = (
          await tx.ldapProvider.create({
            data: {
              ...fields,
              // Sem a senha do bind, o provedor entra desativado.
              enabled: bindPassword ? fields.enabled : false,
              position: (last._max.position ?? -1) + 1,
              bindPasswordEnc: this.secrets.encrypt(bindPassword ?? ''),
            },
          })
        ).id;
        this.report.ldapProviders.created++;
      }
      this.report.ldapProviders.names.push(fields.name);

      const kept: string[] = [];
      for (const m of raw.mappings) {
        const page = m.page ? await tx.page.findUnique({ where: { slug: m.page } }) : null;
        if (m.page && !page) {
          this.warn(`ldap:${fields.name}`, 'mapping_page_missing', m.page);
          continue;
        }
        const parsed = ldapMappingCreateSchema.safeParse({
          groupDn: m.groupDn,
          pageId: page?.id ?? null,
          role: m.role,
        });
        if (!parsed.success) {
          this.warn(`ldap:${fields.name}`, 'invalid_ldap_mapping', m.groupDn);
          continue;
        }
        const existing = await tx.ldapGroupMapping.findFirst({
          where: { providerId, groupDn: parsed.data.groupDn, pageId: parsed.data.pageId },
        });
        const row = existing
          ? await tx.ldapGroupMapping.update({
              where: { id: existing.id },
              data: { role: parsed.data.role },
            })
          : await tx.ldapGroupMapping.create({ data: { providerId, ...parsed.data } });
        kept.push(row.id);
      }
      if (this.mode === 'replace') {
        await tx.ldapGroupMapping.deleteMany({ where: { providerId, id: { notIn: kept } } });
      }
    }
  }
}
