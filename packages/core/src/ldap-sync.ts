import { type Prisma, type PrismaClient } from '@status-page/db';
import { roleAtLeast, type Role } from '@status-page/shared';
import { recordAudit, type AuditContext } from './audit.js';
import { type Db } from './db.js';
import {
  type DirectoryUser,
  type LdapConfig,
  type LdapDirectory,
  LdapUnavailableError,
  normalizeDn,
} from './ldap.js';
import { type SecretBox } from './secret-box.js';

/**
 * Aplica no banco o que veio do diretório: cria o usuário no primeiro login
 * (JIT), atualiza nome, e-mail e grupos e recalcula os papéis mapeados.
 */

export interface ProviderForSync {
  id: string;
  name: string;
  manualRolesWin: boolean;
  linkByEmail: boolean;
  mappings: { groupDn: string; pageId: string | null; role: Role }[];
}

export class LdapEmailConflictError extends Error {
  constructor(readonly email: string) {
    super('já existe um usuário com este e-mail');
  }
}

export interface MappedRoles {
  owner: boolean;
  /** pageId → maior papel concedido pelos grupos. */
  pages: Map<string, Exclude<Role, 'owner'>>;
}

/** Papéis concedidos pelos grupos do usuário (o maior papel vence em cada página). */
export function mappedRoles(
  mappings: ProviderForSync['mappings'],
  groups: readonly string[],
): MappedRoles {
  const member = new Set(groups.map(normalizeDn));
  const result: MappedRoles = { owner: false, pages: new Map() };
  for (const mapping of mappings) {
    if (!member.has(normalizeDn(mapping.groupDn))) continue;
    if (mapping.role === 'owner' || mapping.pageId === null) {
      result.owner ||= mapping.role === 'owner';
      continue;
    }
    const current = result.pages.get(mapping.pageId);
    if (!current || roleAtLeast(mapping.role, current)) {
      result.pages.set(mapping.pageId, mapping.role);
    }
  }
  return result;
}

export function ldapSubject(providerId: string, uniqueId: string): string {
  return `${providerId}:${uniqueId}`;
}

/** E-mail usado quando o diretório não informa um (o campo é obrigatório no usuário). */
function fallbackEmail(user: DirectoryUser, providerId: string): string {
  const local = user.username.toLowerCase().replace(/[^a-z0-9._-]/g, '_') || 'user';
  return `${local}@${providerId.slice(0, 8)}.ldap.invalid`;
}

export interface SyncOutcome {
  userId: string;
  identityId: string;
  created: boolean;
  /** Conta desativada manualmente no painel: o login deve ser recusado. */
  userDisabled: boolean;
}

/**
 * Cria ou atualiza o usuário a partir da entrada do diretório. Deve rodar numa
 * transação: `db` pode ser um client de transação.
 */
export async function upsertDirectoryUser(
  db: Db,
  provider: ProviderForSync,
  dirUser: DirectoryUser,
  audit: AuditContext,
): Promise<SyncOutcome> {
  const subject = ldapSubject(provider.id, dirUser.uniqueId);
  const email = dirUser.email ?? fallbackEmail(dirUser, provider.id);
  const name = dirUser.name?.trim() || dirUser.username;
  const identityData = {
    ldapProviderId: provider.id,
    dn: dirUser.dn,
    username: dirUser.username,
    groups: dirUser.groups,
    disabledAt: null,
    lastSyncAt: new Date(),
  };

  let identity = await db.userIdentity.findUnique({
    where: { provider_subject: { provider: 'ldap', subject } },
    include: { user: true },
  });
  let created = false;

  if (!identity) {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      // Vincular por e-mail entrega a conta existente a quem controla o diretório:
      // só acontece se o Dono habilitou isso no provedor.
      if (!provider.linkByEmail) throw new LdapEmailConflictError(email);
      identity = await db.userIdentity.create({
        data: { userId: existing.id, provider: 'ldap', subject, ...identityData },
        include: { user: true },
      });
      await recordAudit(db, {
        ...audit,
        actorId: existing.id,
        action: 'ldap.identity_link',
        entityType: 'user',
        entityId: existing.id,
        after: { provider: provider.name, dn: dirUser.dn },
      });
    } else {
      const user = await db.user.create({
        data: {
          email,
          name,
          identities: { create: { provider: 'ldap', subject, ...identityData } },
        },
        include: { identities: true },
      });
      identity = { ...user.identities[0]!, user };
      created = true;
      await recordAudit(db, {
        ...audit,
        actorId: user.id,
        action: 'ldap.user_create',
        entityType: 'user',
        entityId: user.id,
        after: { email, name, provider: provider.name, dn: dirUser.dn },
      });
    }
  } else {
    await db.userIdentity.update({ where: { id: identity.id }, data: identityData });
    const changes: Prisma.UserUpdateInput = {};
    if (identity.user.name !== name) changes.name = name;
    if (identity.user.email !== email) {
      const taken = await db.user.findUnique({ where: { email } });
      if (!taken) changes.email = email;
    }
    if (Object.keys(changes).length > 0) {
      await db.user.update({ where: { id: identity.userId }, data: changes });
    }
  }

  await applyMappedRoles(db, provider, identity.userId, dirUser.groups, audit);
  return {
    userId: identity.userId,
    identityId: identity.id,
    created,
    userDisabled: Boolean(identity.user.disabledAt),
  };
}

/**
 * Recalcula os papéis que vêm de grupos. Papéis manuais ficam intactos quando
 * `manualRolesWin`; caso contrário, o mapeado substitui o manual na mesma página.
 */
export async function applyMappedRoles(
  db: Db,
  provider: ProviderForSync,
  userId: string,
  groups: readonly string[],
  audit: AuditContext,
): Promise<void> {
  const mapped = mappedRoles(provider.mappings, groups);
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { pageRoles: true },
  });
  const before = Object.fromEntries(user.pageRoles.map((r) => [r.pageId, r.role]));

  for (const existing of user.pageRoles) {
    if (existing.manual) continue;
    if (!mapped.pages.has(existing.pageId)) {
      await db.userPageRole.delete({
        where: { userId_pageId: { userId, pageId: existing.pageId } },
      });
    }
  }
  for (const [pageId, role] of mapped.pages) {
    const existing = user.pageRoles.find((r) => r.pageId === pageId);
    if (existing?.manual && provider.manualRolesWin) continue;
    if (existing && existing.role === role && !existing.manual) continue;
    await db.userPageRole.upsert({
      where: { userId_pageId: { userId, pageId } },
      create: { userId, pageId, role, manual: false },
      update: { role, manual: false },
    });
  }

  let ownerChange: boolean | null = null;
  if (mapped.owner && !user.isOwner) {
    await db.user.update({ where: { id: userId }, data: { isOwner: true, ownerViaLdap: true } });
    ownerChange = true;
  } else if (!mapped.owner && user.ownerViaLdap) {
    // Nunca remove o último Dono ativo (a conta de emergência deveria existir).
    const others = await db.user.count({
      where: { isOwner: true, disabledAt: null, id: { not: userId } },
    });
    if (others > 0) {
      await db.user.update({
        where: { id: userId },
        data: { isOwner: false, ownerViaLdap: false },
      });
      ownerChange = false;
    }
  }

  const after = Object.fromEntries(
    (await db.userPageRole.findMany({ where: { userId } })).map((r) => [r.pageId, r.role]),
  );
  if (JSON.stringify(before) !== JSON.stringify(after) || ownerChange !== null) {
    await recordAudit(db, {
      ...audit,
      action: 'ldap.roles_sync',
      entityType: 'user',
      entityId: userId,
      before: { roles: before, isOwner: user.isOwner },
      after: { roles: after, isOwner: ownerChange ?? user.isOwner, provider: provider.name },
    });
  }
}

/**
 * A conta foi desativada ou removida do diretório: marca a identidade, retira
 * os papéis vindos de grupos e encerra as sessões do usuário.
 */
export async function disableDirectoryIdentity(
  db: Db,
  identityId: string,
  reason: 'disabled' | 'not_found',
  audit: AuditContext,
): Promise<void> {
  const identity = await db.userIdentity.findUniqueOrThrow({
    where: { id: identityId },
    include: { user: true },
  });
  if (identity.disabledAt) return;
  const now = new Date();
  await db.userIdentity.update({ where: { id: identityId }, data: { disabledAt: now } });
  await db.userPageRole.deleteMany({ where: { userId: identity.userId, manual: false } });
  if (identity.user.ownerViaLdap) {
    const others = await db.user.count({
      where: { isOwner: true, disabledAt: null, id: { not: identity.userId } },
    });
    if (others > 0) {
      await db.user.update({
        where: { id: identity.userId },
        data: { isOwner: false, ownerViaLdap: false },
      });
    }
  }
  // A conta de emergência não depende do diretório; as demais perdem as sessões.
  await db.session.updateMany({
    where: {
      userId: identity.userId,
      revokedAt: null,
      ...(identity.user.isBreakGlass ? { identityId } : {}),
    },
    data: { revokedAt: now },
  });
  await recordAudit(db, {
    ...audit,
    action: 'ldap.identity_disable',
    entityType: 'user',
    entityId: identity.userId,
    after: { reason, dn: identity.dn },
  });
}

// --- Sincronização periódica -------------------------------------------------

export interface ProviderRow extends ProviderForSync {
  kind: LdapConfig['kind'];
  host: string;
  port: number;
  security: LdapConfig['security'];
  verifyCertificate: boolean;
  caCertificate: string | null;
  bindDn: string;
  bindPasswordEnc: string;
  baseDn: string;
  userFilter: string;
  usernameAttribute: string;
  emailAttribute: string;
  nameAttribute: string;
  uniqueIdAttribute: string;
  nestedGroups: boolean;
  groupBaseDn: string | null;
  groupFilter: string | null;
  timeoutMs: number;
}

/** Converte a linha do banco na configuração do cliente, decifrando a senha do bind. */
export function providerConfig(row: ProviderRow, secrets: SecretBox): LdapConfig {
  return {
    kind: row.kind,
    host: row.host,
    port: row.port,
    security: row.security,
    verifyCertificate: row.verifyCertificate,
    caCertificate: row.caCertificate,
    bindDn: row.bindDn,
    bindPassword: secrets.decrypt(row.bindPasswordEnc),
    baseDn: row.baseDn,
    userFilter: row.userFilter,
    usernameAttribute: row.usernameAttribute,
    emailAttribute: row.emailAttribute,
    nameAttribute: row.nameAttribute,
    uniqueIdAttribute: row.uniqueIdAttribute,
    nestedGroups: row.nestedGroups,
    groupBaseDn: row.groupBaseDn,
    groupFilter: row.groupFilter,
    timeoutMs: row.timeoutMs,
  };
}

export interface ProviderSyncResult {
  checked: number;
  updated: number;
  disabled: number;
  /** Código do erro de infraestrutura que interrompeu a sincronização. */
  error: string | null;
}

/**
 * Relê no diretório todos os usuários vindos deste provedor. Conta desativada
 * ou removida perde o acesso; grupos e papéis são atualizados. Se o servidor
 * estiver fora do ar, ninguém é desativado: a sincronização para e registra o erro.
 */
export async function syncLdapProvider(
  prisma: PrismaClient,
  provider: ProviderForSync,
  directory: Pick<LdapDirectory, 'lookup'>,
  audit: AuditContext = {},
): Promise<ProviderSyncResult> {
  const identities = await prisma.userIdentity.findMany({
    where: { provider: 'ldap', ldapProviderId: provider.id },
    select: { id: true, subject: true, dn: true, username: true, disabledAt: true },
  });
  const result: ProviderSyncResult = { checked: 0, updated: 0, disabled: 0, error: null };
  const prefix = `${provider.id}:`;

  for (const identity of identities) {
    const uniqueId = identity.subject.startsWith(prefix)
      ? identity.subject.slice(prefix.length)
      : identity.subject;
    let dirUser: DirectoryUser | null;
    try {
      dirUser = await directory.lookup({ dn: identity.dn, username: identity.username, uniqueId });
    } catch (error) {
      result.error = error instanceof LdapUnavailableError ? error.reason : 'lookup_failed';
      break;
    }
    result.checked++;
    if (!dirUser || dirUser.disabled) {
      if (!identity.disabledAt) {
        await prisma.$transaction((tx) =>
          disableDirectoryIdentity(tx, identity.id, dirUser ? 'disabled' : 'not_found', audit),
        );
        result.disabled++;
      }
      continue;
    }
    await prisma.$transaction((tx) => upsertDirectoryUser(tx, provider, dirUser, audit));
    result.updated++;
  }

  await prisma.ldapProvider.update({
    where: { id: provider.id },
    data: { lastSyncAt: new Date(), lastSyncError: result.error },
  });
  return result;
}
