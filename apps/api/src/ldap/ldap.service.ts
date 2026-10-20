import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type AuditContext,
  type LdapAuthResult,
  type LdapConfig,
  LdapDirectory,
  LdapUnavailableError,
  mappedRoles,
  normalizeDn,
  type ProviderRow,
  providerConfig,
  type ProviderSyncResult,
  recordAudit,
  syncLdapProvider,
} from '@status-page/core';
import {
  type ldapProviderCreateSchema,
  type ldapProviderUpdateSchema,
  type Role,
} from '@status-page/shared';
import { type z } from 'zod';
import { PrismaService } from '../infra/prisma.service.js';
import { SecretsService } from '../infra/secrets.service.js';

type CreateInput = z.infer<typeof ldapProviderCreateSchema>;
type UpdateInput = z.infer<typeof ldapProviderUpdateSchema>;

/** O que o serviço usa do cliente LDAP (substituível nos testes). */
export type Directory = Pick<LdapDirectory, 'authenticate' | 'lookup' | 'testConnection'>;

const PROVIDER_PUBLIC = {
  id: true,
  name: true,
  kind: true,
  enabled: true,
  position: true,
  host: true,
  port: true,
  security: true,
  verifyCertificate: true,
  caCertificate: true,
  bindDn: true,
  baseDn: true,
  userFilter: true,
  usernameAttribute: true,
  emailAttribute: true,
  nameAttribute: true,
  uniqueIdAttribute: true,
  nestedGroups: true,
  groupBaseDn: true,
  groupFilter: true,
  manualRolesWin: true,
  linkByEmail: true,
  timeoutMs: true,
  lastSyncAt: true,
  lastSyncError: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Campos do formulário que são auditados (nunca a senha). */
function auditable(input: Partial<CreateInput>) {
  const rest = { ...input };
  delete rest.bindPassword;
  return rest;
}

@Injectable()
export class LdapService {
  private readonly log = new Logger(LdapService.name);
  /** Fábrica do cliente LDAP; os testes da API trocam por um diretório falso. */
  directoryFactory: (config: LdapConfig) => Directory = (config) => new LdapDirectory(config);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  // --- Provedores ------------------------------------------------------------

  async list() {
    const providers = await this.prisma.client.ldapProvider.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { ...PROVIDER_PUBLIC, _count: { select: { identities: true, mappings: true } } },
    });
    return providers.map(({ _count, ...p }) => ({
      ...p,
      users: _count.identities,
      mappingCount: _count.mappings,
    }));
  }

  async get(id: string) {
    const provider = await this.prisma.client.ldapProvider.findUnique({
      where: { id },
      select: {
        ...PROVIDER_PUBLIC,
        mappings: {
          orderBy: [{ groupDn: 'asc' }],
          select: {
            id: true,
            groupDn: true,
            pageId: true,
            role: true,
            page: { select: { name: true } },
          },
        },
        _count: { select: { identities: true } },
      },
    });
    if (!provider) throw new NotFoundException({ message: 'ldap_provider_not_found' });
    const { _count, ...rest } = provider;
    return { ...rest, users: _count.identities };
  }

  async create(input: CreateInput, audit: AuditContext) {
    const last = await this.prisma.client.ldapProvider.aggregate({ _max: { position: true } });
    return this.prisma.client.$transaction(async (tx) => {
      const { bindPassword, ...data } = input;
      const created = await tx.ldapProvider.create({
        data: {
          ...data,
          position: (last._max.position ?? -1) + 1,
          bindPasswordEnc: this.secrets.encrypt(bindPassword),
        },
        select: PROVIDER_PUBLIC,
      });
      await recordAudit(tx, {
        ...audit,
        action: 'ldap.provider_create',
        entityType: 'ldap_provider',
        entityId: created.id,
        after: auditable(input),
      });
      return created;
    });
  }

  async update(id: string, input: UpdateInput, audit: AuditContext) {
    const before = await this.prisma.client.ldapProvider.findUnique({
      where: { id },
      select: PROVIDER_PUBLIC,
    });
    if (!before) throw new NotFoundException({ message: 'ldap_provider_not_found' });
    return this.prisma.client.$transaction(async (tx) => {
      const { bindPassword, ...data } = input;
      const updated = await tx.ldapProvider.update({
        where: { id },
        data: {
          ...data,
          ...(bindPassword ? { bindPasswordEnc: this.secrets.encrypt(bindPassword) } : {}),
        },
        select: PROVIDER_PUBLIC,
      });
      await recordAudit(tx, {
        ...audit,
        action: 'ldap.provider_update',
        entityType: 'ldap_provider',
        entityId: id,
        before,
        after: { ...auditable(input), bindPasswordChanged: Boolean(bindPassword) },
      });
      return updated;
    });
  }

  /** Remove o provedor; os usuários vindos dele perdem a identidade LDAP e as sessões. */
  async remove(id: string, audit: AuditContext): Promise<void> {
    const provider = await this.prisma.client.ldapProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException({ message: 'ldap_provider_not_found' });
    await this.prisma.client.$transaction(async (tx) => {
      const identities = await tx.userIdentity.findMany({
        where: { ldapProviderId: id },
        select: { id: true, userId: true },
      });
      await tx.session.updateMany({
        where: { identityId: { in: identities.map((i) => i.id) }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.userPageRole.deleteMany({
        where: { userId: { in: identities.map((i) => i.userId) }, manual: false },
      });
      await tx.ldapProvider.delete({ where: { id } });
      await recordAudit(tx, {
        ...audit,
        action: 'ldap.provider_delete',
        entityType: 'ldap_provider',
        entityId: id,
        before: { name: provider.name, host: provider.host, users: identities.length },
      });
    });
  }

  // --- Testes ----------------------------------------------------------------

  /** Testa a conexão com dados do formulário (ainda não salvos). */
  async testConnection(input: UpdateInput & { id?: string }) {
    let bindPassword = input.bindPassword;
    if (!bindPassword && input.id) {
      const stored = await this.prisma.client.ldapProvider.findUnique({ where: { id: input.id } });
      if (stored) bindPassword = this.secrets.decrypt(stored.bindPasswordEnc);
    }
    if (!bindPassword) throw new BadRequestException({ message: 'bind_password_required' });
    const directory = this.directoryFactory({ ...input, bindPassword });
    try {
      const { durationMs } = await directory.testConnection();
      return { ok: true as const, durationMs };
    } catch (error) {
      return { ok: false as const, error: this.reason(error) };
    }
  }

  /**
   * Testa o login de um usuário sem criar nada: mostra o que o diretório
   * devolve e os papéis que os mapeamentos dariam.
   */
  async testLogin(id: string, username: string, password: string, audit: AuditContext) {
    const provider = await this.providerRow(id);
    const directory = this.directoryFactory(providerConfig(provider, this.secrets));
    let result: LdapAuthResult;
    try {
      result = await directory.authenticate(username, password);
    } catch (error) {
      return { status: 'unavailable' as const, error: this.reason(error) };
    } finally {
      await recordAudit(this.prisma.client, {
        ...audit,
        action: 'ldap.test_login',
        entityType: 'ldap_provider',
        entityId: id,
        after: { username },
      });
    }
    if (result.status !== 'ok' && result.status !== 'disabled') return { status: result.status };
    const mapped = mappedRoles(provider.mappings, result.user.groups);
    const pages = await this.prisma.client.page.findMany({
      where: { id: { in: [...mapped.pages.keys()] } },
      select: { id: true, name: true },
    });
    const pageName = new Map(pages.map((p) => [p.id, p.name]));
    return {
      status: result.status,
      user: result.user,
      roles: {
        owner: mapped.owner,
        pages: [...mapped.pages].map(([pageId, role]) => ({
          pageId,
          pageName: pageName.get(pageId) ?? pageId,
          role,
        })),
      },
    };
  }

  async syncNow(id: string, audit: AuditContext): Promise<ProviderSyncResult> {
    const provider = await this.providerRow(id);
    const directory = this.directoryFactory(providerConfig(provider, this.secrets));
    const result = await syncLdapProvider(this.prisma.client, provider, directory, audit);
    await recordAudit(this.prisma.client, {
      ...audit,
      action: 'ldap.sync',
      entityType: 'ldap_provider',
      entityId: id,
      after: result,
    });
    return result;
  }

  // --- Mapeamentos -----------------------------------------------------------

  async addMapping(
    providerId: string,
    input: { groupDn: string; pageId: string | null; role: Role },
    audit: AuditContext,
  ) {
    await this.providerRow(providerId);
    if (input.pageId) {
      const page = await this.prisma.client.page.findUnique({ where: { id: input.pageId } });
      if (!page) throw new NotFoundException({ message: 'page_not_found' });
    }
    const groupDn = normalizeDn(input.groupDn);
    const duplicate = await this.prisma.client.ldapGroupMapping.findFirst({
      where: { providerId, groupDn, pageId: input.pageId },
    });
    if (duplicate) throw new ConflictException({ message: 'mapping_exists' });
    return this.prisma.client.$transaction(async (tx) => {
      const mapping = await tx.ldapGroupMapping.create({
        data: { providerId, groupDn, pageId: input.pageId, role: input.role },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'ldap.mapping_create',
        entityType: 'ldap_provider',
        entityId: providerId,
        pageId: input.pageId,
        after: { groupDn, pageId: input.pageId, role: input.role },
      });
      return mapping;
    });
  }

  async removeMapping(providerId: string, mappingId: string, audit: AuditContext): Promise<void> {
    const mapping = await this.prisma.client.ldapGroupMapping.findFirst({
      where: { id: mappingId, providerId },
    });
    if (!mapping) throw new NotFoundException({ message: 'mapping_not_found' });
    await this.prisma.client.$transaction(async (tx) => {
      await tx.ldapGroupMapping.delete({ where: { id: mappingId } });
      await recordAudit(tx, {
        ...audit,
        action: 'ldap.mapping_delete',
        entityType: 'ldap_provider',
        entityId: providerId,
        pageId: mapping.pageId,
        before: { groupDn: mapping.groupDn, pageId: mapping.pageId, role: mapping.role },
      });
    });
  }

  // --- Login -----------------------------------------------------------------

  /** Provedores habilitados, na ordem de tentativa, prontos para autenticar. */
  async enabledDirectories(): Promise<{ provider: ProviderRow; directory: Directory }[]> {
    const rows = await this.prisma.client.ldapProvider.findMany({
      where: { enabled: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { mappings: { select: { groupDn: true, pageId: true, role: true } } },
    });
    return rows.map((provider) => ({
      provider,
      directory: this.directoryFactory(providerConfig(provider, this.secrets)),
    }));
  }

  private async providerRow(id: string): Promise<ProviderRow> {
    const provider = await this.prisma.client.ldapProvider.findUnique({
      where: { id },
      include: { mappings: { select: { groupDn: true, pageId: true, role: true } } },
    });
    if (!provider) throw new NotFoundException({ message: 'ldap_provider_not_found' });
    return provider;
  }

  reason(error: unknown): string {
    if (error instanceof LdapUnavailableError) return error.reason;
    this.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'erro LDAP');
    return 'unknown_error';
  }
}
