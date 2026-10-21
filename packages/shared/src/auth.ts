import { z } from 'zod';
import { ROLES, type Role } from './roles.js';

/**
 * Autenticação corporativa (LDAP) e MFA: tipos, valores padrão e schemas de
 * entrada compartilhados entre a API e o painel.
 */

export const LDAP_KINDS = ['active_directory', 'openldap'] as const;
export type LdapKind = (typeof LDAP_KINDS)[number];

export const LDAP_SECURITY = ['ldaps', 'starttls', 'none'] as const;
export type LdapSecurity = (typeof LDAP_SECURITY)[number];

export interface LdapDefaults {
  port: number;
  security: LdapSecurity;
  userFilter: string;
  usernameAttribute: string;
  emailAttribute: string;
  nameAttribute: string;
  uniqueIdAttribute: string;
  nestedGroups: boolean;
  groupFilter: string | null;
}

/** Valores pré-preenchidos no formulário para cada tipo de diretório. */
export const LDAP_DEFAULTS: Record<LdapKind, LdapDefaults> = {
  active_directory: {
    port: 636,
    security: 'ldaps',
    // Aceita tanto o sAMAccountName quanto o UPN (usuario@empresa.local).
    userFilter:
      '(&(objectCategory=person)(objectClass=user)(|(sAMAccountName={username})(userPrincipalName={username})))',
    usernameAttribute: 'sAMAccountName',
    emailAttribute: 'mail',
    nameAttribute: 'displayName',
    uniqueIdAttribute: 'objectGUID',
    nestedGroups: true,
    groupFilter: null,
  },
  openldap: {
    port: 636,
    security: 'ldaps',
    userFilter: '(&(objectClass=inetOrgPerson)(|(uid={username})(mail={username})))',
    usernameAttribute: 'uid',
    emailAttribute: 'mail',
    nameAttribute: 'cn',
    uniqueIdAttribute: 'entryUUID',
    nestedGroups: false,
    groupFilter:
      '(|(&(objectClass=groupOfNames)(member={dn}))(&(objectClass=groupOfUniqueNames)(uniqueMember={dn}))(&(objectClass=posixGroup)(memberUid={username})))',
  },
};

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** DN simples: só checa que tem ao menos um par atributo=valor. */
const dn = text(1024).refine((v) => /^[a-zA-Z][\w-]*=/.test(v), { message: 'invalid_dn' });

const ldapFilter = text(2048).refine(
  (v) => v.startsWith('(') && v.endsWith(')') && balancedParens(v),
  { message: 'invalid_filter' },
);

function balancedParens(value: string): boolean {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') {
      i++;
      continue;
    }
    if (value[i] === '(') depth++;
    if (value[i] === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

const attribute = z
  .string()
  .trim()
  .regex(/^[a-zA-Z][\w-]{0,63}$/, { message: 'invalid_attribute' });

const pem = z
  .string()
  .trim()
  .max(32_768)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || v.includes('-----BEGIN CERTIFICATE-----'), {
    message: 'invalid_certificate',
  });

const ldapProviderFields = {
  name: text(120),
  kind: z.enum(LDAP_KINDS),
  enabled: z.boolean().default(true),
  host: text(255).regex(/^[a-zA-Z0-9.:[\]-]+$/, { message: 'invalid_host' }),
  port: z.coerce.number().int().min(1).max(65_535),
  security: z.enum(LDAP_SECURITY),
  verifyCertificate: z.boolean().default(true),
  caCertificate: pem,
  bindDn: dn,
  baseDn: dn,
  userFilter: ldapFilter.refine((v) => v.includes('{username}'), {
    message: 'filter_needs_username',
  }),
  usernameAttribute: attribute,
  emailAttribute: attribute,
  nameAttribute: attribute,
  uniqueIdAttribute: attribute,
  nestedGroups: z.boolean().default(false),
  groupBaseDn: optionalText(1024),
  groupFilter: optionalText(2048).refine((v) => v === null || ldapFilter.safeParse(v).success, {
    message: 'invalid_filter',
  }),
  manualRolesWin: z.boolean().default(true),
  linkByEmail: z.boolean().default(false),
  timeoutMs: z.coerce.number().int().min(1000).max(60_000).default(5000),
};

/** Senha do bind: obrigatória na criação; em branco na edição mantém a atual. */
export const ldapProviderCreateSchema = z.object({
  ...ldapProviderFields,
  bindPassword: z.string().min(1).max(1024),
});

export const ldapProviderUpdateSchema = z.object({
  ...ldapProviderFields,
  bindPassword: z
    .string()
    .max(1024)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/** Teste de conexão com dados ainda não salvos; `id` reaproveita a senha guardada. */
export const ldapConnectionTestSchema = ldapProviderUpdateSchema.extend({
  id: z.uuid().optional(),
});

export const ldapLoginTestSchema = z.object({
  username: text(256),
  password: z.string().min(1).max(1024),
});

export const ldapMappingCreateSchema = z
  .object({
    groupDn: dn,
    pageId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    role: z.enum(ROLES),
  })
  .refine((v) => (v.role === 'owner') === (v.pageId === null), {
    message: 'owner_mapping_scope',
    path: ['pageId'],
  });

// --- Política de acesso -----------------------------------------------------

export const MFA_POLICY_MODES = ['off', 'roles', 'all'] as const;
export type MfaPolicyMode = (typeof MFA_POLICY_MODES)[number];

export const LOCAL_LOGIN_MODES = ['all', 'break_glass_only'] as const;
export type LocalLoginMode = (typeof LOCAL_LOGIN_MODES)[number];

export const authSettingsSchema = z.object({
  mfa: z.object({
    mode: z.enum(MFA_POLICY_MODES),
    /** Papéis que exigem MFA quando `mode = roles`. */
    roles: z.array(z.enum(ROLES)).max(ROLES.length).default([]),
  }),
  /** `break_glass_only`: só contas de emergência entram com senha local. */
  localLogin: z.enum(LOCAL_LOGIN_MODES),
});
export type AuthSettings = z.infer<typeof authSettingsSchema>;

export const DEFAULT_AUTH_SETTINGS: AuthSettings = {
  mfa: { mode: 'off', roles: [] },
  localLogin: 'all',
};

/**
 * MFA é obrigatório para este usuário? No modo `roles`, basta ter um dos papéis
 * exigidos (Dono ou em qualquer página).
 */
export function mfaRequiredFor(
  policy: AuthSettings['mfa'],
  user: { isOwner: boolean; roles: Iterable<Role> },
): boolean {
  if (policy.mode === 'off') return false;
  if (policy.mode === 'all') return true;
  const required = new Set(policy.roles);
  if (user.isOwner && required.has('owner')) return true;
  for (const role of user.roles) if (required.has(role)) return true;
  return false;
}

// --- MFA --------------------------------------------------------------------

export const MFA_METHODS = ['totp', 'webauthn', 'recovery'] as const;
export type MfaMethod = (typeof MFA_METHODS)[number];

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, { message: 'invalid_code' })),
});

export const mfaVerifySchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('totp'), code: totpCodeSchema.shape.code }),
  z.object({ method: z.literal('recovery'), code: z.string().trim().min(1).max(64) }),
]);

/** Resposta do navegador ao WebAuthn: validada em detalhe pela biblioteca no servidor. */
export const webauthnResponseSchema = z.object({
  response: z.record(z.string(), z.unknown()),
});

export const webauthnRegisterSchema = webauthnResponseSchema.extend({
  name: text(60),
});
