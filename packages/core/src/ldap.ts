import { type ConnectionOptions } from 'node:tls';
import { Client, InvalidCredentialsError, NoSuchObjectError, type Entry } from 'ldapts';
import { type LdapKind, type LdapSecurity } from '@status-page/shared';

/**
 * Acesso a diretórios LDAP (Active Directory e OpenLDAP): busca do usuário com
 * a conta de serviço, bind com a senha do próprio usuário e leitura dos grupos.
 */

export interface LdapConfig {
  kind: LdapKind;
  host: string;
  port: number;
  security: LdapSecurity;
  verifyCertificate: boolean;
  caCertificate: string | null;
  bindDn: string;
  bindPassword: string;
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

export interface DirectoryUser {
  dn: string;
  /** objectGUID / entryUUID; na falta deles, o DN normalizado. */
  uniqueId: string;
  username: string;
  email: string | null;
  name: string | null;
  /** DNs dos grupos, normalizados (minúsculas, sem espaços entre RDNs). */
  groups: string[];
  /** Conta desativada (AD) ou bloqueada pela política de senha (OpenLDAP). */
  disabled: boolean;
}

export type LdapAuthResult =
  | { status: 'ok'; user: DirectoryUser }
  | { status: 'invalid_credentials' }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'disabled'; user: DirectoryUser };

/** Falha de infraestrutura (rede, TLS, conta de serviço): não é culpa do usuário. */
export class LdapUnavailableError extends Error {
  constructor(
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`LDAP indisponível: ${reason}`, options);
  }
}

/** AD: bit ACCOUNTDISABLE de userAccountControl. */
const AD_ACCOUNT_DISABLED = 0x2;
/** Regra que percorre a cadeia de grupos aninhados no AD. */
const AD_IN_CHAIN = '1.2.840.113556.1.4.1941';
const BINARY_ATTRIBUTES = new Set(['objectguid', 'objectsid']);

/** Escapa um valor para uso dentro de um filtro LDAP (RFC 4515). */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** Substitui `{username}` e `{dn}` no modelo de filtro, sempre escapando. */
export function renderFilter(template: string, values: { username?: string; dn?: string }): string {
  return template
    .replaceAll('{username}', escapeFilterValue(values.username ?? ''))
    .replaceAll('{dn}', escapeFilterValue(values.dn ?? ''));
}

/** Forma canônica de um DN para comparação: minúsculas e sem espaços em volta de `,` e `=`. */
export function normalizeDn(dn: string): string {
  return dn
    .trim()
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*=\s*/g, '=')
    .toLowerCase();
}

/** objectGUID do AD: os três primeiros blocos ficam em little-endian. */
export function formatObjectGuid(buf: Buffer): string {
  if (buf.length !== 16) return buf.toString('hex');
  const hex = (b: Buffer) => b.toString('hex');
  const le = (start: number, end: number) => hex(Buffer.from(buf.subarray(start, end)).reverse());
  return [le(0, 4), le(4, 6), le(6, 8), hex(buf.subarray(8, 10)), hex(buf.subarray(10, 16))].join(
    '-',
  );
}

function first(entry: Entry, attribute: string): string | null {
  const key = Object.keys(entry).find((k) => k.toLowerCase() === attribute.toLowerCase());
  if (!key) return null;
  const value = entry[key];
  const item = Array.isArray(value) ? value[0] : value;
  if (item === undefined) return null;
  if (Buffer.isBuffer(item)) {
    return attribute.toLowerCase() === 'objectguid' ? formatObjectGuid(item) : item.toString('hex');
  }
  return String(item);
}

function all(entry: Entry, attribute: string): string[] {
  const key = Object.keys(entry).find((k) => k.toLowerCase() === attribute.toLowerCase());
  if (!key) return [];
  const value = entry[key];
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.map((v) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v)));
}

export class LdapDirectory {
  constructor(private readonly config: LdapConfig) {}

  get url(): string {
    const scheme = this.config.security === 'ldaps' ? 'ldaps' : 'ldap';
    const host = this.config.host.includes(':') ? `[${this.config.host}]` : this.config.host;
    return `${scheme}://${host}:${this.config.port}`;
  }

  private tlsOptions(): ConnectionOptions {
    return {
      servername: this.config.host,
      rejectUnauthorized: this.config.verifyCertificate,
      ...(this.config.caCertificate ? { ca: [this.config.caCertificate] } : {}),
    };
  }

  /** Abre uma conexão (com StartTLS se configurado) e faz o bind indicado. */
  private async connect(dn: string, password: string): Promise<Client> {
    const client = new Client({
      url: this.url,
      timeout: this.config.timeoutMs,
      connectTimeout: this.config.timeoutMs,
      // O ldapts abre TLS direto sempre que recebe tlsOptions: só no ldaps://.
      ...(this.config.security === 'ldaps' ? { tlsOptions: this.tlsOptions() } : {}),
      strictDN: false,
    });
    try {
      if (this.config.security === 'starttls') await client.startTLS(this.tlsOptions());
      await client.bind(dn, password);
      return client;
    } catch (error) {
      await client.unbind().catch(() => undefined);
      throw error;
    }
  }

  private async serviceClient(): Promise<Client> {
    try {
      return await this.connect(this.config.bindDn, this.config.bindPassword);
    } catch (error) {
      throw new LdapUnavailableError(describeError(error, 'service_bind_failed'), {
        cause: error,
      });
    }
  }

  private userAttributes(): string[] {
    const c = this.config;
    const list = [c.usernameAttribute, c.emailAttribute, c.nameAttribute, c.uniqueIdAttribute];
    if (c.kind === 'active_directory') list.push('userAccountControl', 'memberOf');
    else list.push('pwdAccountLockedTime', 'memberOf');
    return [...new Set(list)];
  }

  private async findEntries(client: Client, base: string, filter: string, scope: 'sub' | 'base') {
    const { searchEntries } = await client.search(base, {
      scope,
      filter,
      attributes: this.userAttributes(),
      explicitBufferAttributes: this.userAttributes().filter((a) =>
        BINARY_ATTRIBUTES.has(a.toLowerCase()),
      ),
      sizeLimit: 2,
      timeLimit: Math.ceil(this.config.timeoutMs / 1000),
    });
    return searchEntries;
  }

  private async toDirectoryUser(
    client: Client,
    entry: Entry,
    fallbackUsername: string,
  ): Promise<DirectoryUser> {
    const c = this.config;
    const username = first(entry, c.usernameAttribute) ?? fallbackUsername;
    // AD: bit ACCOUNTDISABLE; OpenLDAP: conta bloqueada pela política de senha (ppolicy).
    const disabled =
      c.kind === 'active_directory'
        ? (Number(first(entry, 'userAccountControl') ?? 0) & AD_ACCOUNT_DISABLED) !== 0
        : first(entry, 'pwdAccountLockedTime') !== null;
    return {
      dn: entry.dn,
      uniqueId: first(entry, c.uniqueIdAttribute) ?? normalizeDn(entry.dn),
      username,
      email: first(entry, c.emailAttribute)?.toLowerCase() ?? null,
      name: first(entry, c.nameAttribute),
      groups: await this.groupsOf(client, entry, username),
      disabled,
    };
  }

  /** Grupos do usuário: aninhados via IN_CHAIN no AD ou busca de grupos no OpenLDAP. */
  private async groupsOf(client: Client, entry: Entry, username: string): Promise<string[]> {
    const c = this.config;
    const groups = new Set(all(entry, 'memberOf').map(normalizeDn));
    let filter: string | null = null;
    let base = c.baseDn;
    if (c.kind === 'active_directory') {
      if (c.nestedGroups) {
        filter = `(&(objectClass=group)(member:${AD_IN_CHAIN}:=${escapeFilterValue(entry.dn)}))`;
      }
    } else if (c.groupFilter) {
      filter = renderFilter(c.groupFilter, { username, dn: entry.dn });
      base = c.groupBaseDn ?? c.baseDn;
    }
    if (filter) {
      const { searchEntries } = await client.search(base, {
        scope: 'sub',
        filter,
        attributes: ['1.1'],
        paged: { pageSize: 500 },
        timeLimit: Math.ceil(c.timeoutMs / 1000),
      });
      for (const group of searchEntries) groups.add(normalizeDn(group.dn));
    }
    return [...groups].sort();
  }

  /** Testa a conexão e a conta de serviço, e confere que a base DN existe. */
  async testConnection(): Promise<{ durationMs: number }> {
    const started = Date.now();
    const client = await this.serviceClient();
    try {
      await client.search(this.config.baseDn, { scope: 'base', attributes: ['1.1'] });
    } catch (error) {
      if (error instanceof NoSuchObjectError) throw new LdapUnavailableError('base_dn_not_found');
      throw new LdapUnavailableError(describeError(error, 'search_failed'), { cause: error });
    } finally {
      await client.unbind().catch(() => undefined);
    }
    return { durationMs: Date.now() - started };
  }

  /**
   * Autentica o usuário: encontra a entrada com a conta de serviço e faz bind
   * com a senha informada. Senha vazia é recusada antes (bind anônimo).
   */
  async authenticate(username: string, password: string): Promise<LdapAuthResult> {
    if (!password) return { status: 'invalid_credentials' };
    const client = await this.serviceClient();
    try {
      let entries: Entry[];
      try {
        entries = await this.findEntries(
          client,
          this.config.baseDn,
          renderFilter(this.config.userFilter, { username }),
          'sub',
        );
      } catch (error) {
        throw new LdapUnavailableError(describeError(error, 'search_failed'), { cause: error });
      }
      if (entries.length === 0) return { status: 'not_found' };
      if (entries.length > 1) return { status: 'ambiguous' };
      const entry = entries[0]!;

      try {
        const userClient = await this.connect(entry.dn, password);
        await userClient.unbind().catch(() => undefined);
      } catch (error) {
        // AD responde 49 (credenciais inválidas) também para contas desativadas.
        if (error instanceof InvalidCredentialsError) {
          const user = await this.toDirectoryUser(client, entry, username).catch(() => null);
          if (user?.disabled) return { status: 'disabled', user };
          return { status: 'invalid_credentials' };
        }
        throw new LdapUnavailableError(describeError(error, 'user_bind_failed'), {
          cause: error,
        });
      }

      const user = await this.toDirectoryUser(client, entry, username);
      if (user.disabled) return { status: 'disabled', user };
      return { status: 'ok', user };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /**
   * Relê um usuário já conhecido (sincronização): pelo DN e, se ele mudou de
   * lugar, pelo login. O identificador único confirma que é a mesma pessoa.
   */
  async lookup(known: {
    dn: string | null;
    username: string | null;
    uniqueId: string;
  }): Promise<DirectoryUser | null> {
    const client = await this.serviceClient();
    try {
      const candidates: Entry[] = [];
      if (known.dn) {
        try {
          candidates.push(...(await this.findEntries(client, known.dn, '(objectClass=*)', 'base')));
        } catch (error) {
          if (!(error instanceof NoSuchObjectError)) {
            throw new LdapUnavailableError(describeError(error, 'search_failed'), {
              cause: error,
            });
          }
        }
      }
      if (candidates.length === 0 && known.username) {
        try {
          candidates.push(
            ...(await this.findEntries(
              client,
              this.config.baseDn,
              renderFilter(this.config.userFilter, { username: known.username }),
              'sub',
            )),
          );
        } catch (error) {
          throw new LdapUnavailableError(describeError(error, 'search_failed'), { cause: error });
        }
      }
      for (const entry of candidates) {
        const user = await this.toDirectoryUser(client, entry, known.username ?? '');
        if (user.uniqueId === known.uniqueId) return user;
      }
      return null;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}

/** Código curto e estável do erro, para exibir no painel e na auditoria. */
function describeError(error: unknown, fallback: string): string {
  if (error instanceof InvalidCredentialsError) return 'service_bind_invalid_credentials';
  if (error instanceof LdapUnavailableError) return error.reason;
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string') {
    if (code === 'ECONNREFUSED') return 'connection_refused';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host_not_found';
    if (code === 'ETIMEDOUT') return 'timeout';
    if (
      code.startsWith('ERR_TLS') ||
      code.includes('CERT') ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    )
      return 'tls_error';
    if (code === 'ECONNRESET') return 'connection_reset';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return 'timeout';
  if (/certificate|self.signed|TLS|SSL/i.test(message)) return 'tls_error';
  if (/confidentiality|strong.?auth/i.test(message)) return 'tls_required';
  return fallback;
}
