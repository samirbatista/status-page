import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  disableDirectoryIdentity,
  type LdapAuthResult,
  LdapEmailConflictError,
  ldapSubject,
  recordAudit,
  type SyncOutcome,
  upsertDirectoryUser,
} from '@status-page/core';
import { type LoginInput } from '@status-page/shared';
import { PrismaService } from '../infra/prisma.service.js';
import { tooManyRequests } from '../common/rate-limit.service.js';
import { type AuthContext, type MfaStage } from '../common/auth.types.js';
import { LdapService } from '../ldap/ldap.service.js';
import { AuthSettingsService } from './auth-settings.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

interface Meta {
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  session: { token: string; id: string; expiresAt: Date };
  mfa: MfaStage;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly throttle: LoginThrottleService,
    private readonly sessions: SessionService,
    private readonly settings: AuthSettingsService,
    private readonly ldap: LdapService,
  ) {}

  /**
   * Login em uma etapa de senha: conta local (pelo e-mail) e, depois, cada
   * provedor LDAP habilitado, na ordem configurada. O segundo fator, quando
   * houver, é confirmado depois em `/auth/mfa/*`.
   */
  async login(input: LoginInput, meta: Meta): Promise<LoginResult> {
    const ip = meta.ip ?? 'unknown';
    const key = input.login.toLowerCase();
    const lockedFor = await this.throttle.lockedFor(key, ip);
    if (lockedFor > 0) throw tooManyRequests(lockedFor);
    const settings = await this.settings.get();

    // 1) Conta local, identificada pelo e-mail.
    const local = key.includes('@')
      ? await this.prisma.client.userIdentity.findUnique({
          where: { provider_subject: { provider: 'local', subject: key } },
          include: { user: { include: { identities: { where: { provider: 'ldap' } } } } },
        })
      : null;
    const localValid = await this.passwords.verify(local?.passwordHash, input.password);
    let failure: string | null = null;
    if (local && localValid) {
      const { user } = local;
      if (user.disabledAt) failure = 'user_disabled';
      else if (settings.localLogin === 'break_glass_only' && !user.isBreakGlass) {
        failure = 'local_login_restricted';
      } else if (!user.isBreakGlass && user.identities.some((i) => i.disabledAt)) {
        // Desativado no diretório: a senha local não serve de porta dos fundos.
        failure = 'directory_disabled';
      } else {
        return this.succeed(user.id, local.id, key, meta, {
          provider: 'local',
          breakGlass: user.isBreakGlass,
        });
      }
    }

    // 2) Diretórios LDAP.
    let unavailable = false;
    if (!failure) {
      for (const { provider, directory } of await this.ldap.enabledDirectories()) {
        let result: LdapAuthResult;
        try {
          result = await directory.authenticate(input.login, input.password);
        } catch (error) {
          unavailable = true;
          this.log.warn(
            { provider: provider.name, reason: this.ldap.reason(error) },
            'provedor LDAP indisponível no login',
          );
          continue;
        }
        if (result.status === 'not_found' || result.status === 'ambiguous') continue;
        if (result.status === 'invalid_credentials') {
          failure = 'invalid_credentials';
          break;
        }
        if (result.status === 'disabled') {
          await this.disableKnownIdentity(provider.id, result.user.uniqueId, meta);
          failure = 'directory_disabled';
          break;
        }
        let outcome: SyncOutcome;
        try {
          outcome = await this.prisma.client.$transaction((tx) =>
            upsertDirectoryUser(tx, provider, result.user, meta),
          );
        } catch (error) {
          if (error instanceof LdapEmailConflictError) {
            await this.fail(key, ip, null, meta, 'ldap_email_conflict');
            throw new ConflictException({ message: 'ldap_email_conflict' });
          }
          throw error;
        }
        if (outcome.userDisabled) {
          failure = 'user_disabled';
          break;
        }
        return this.succeed(outcome.userId, outcome.identityId, key, meta, {
          provider: 'ldap',
          ldapProvider: provider.name,
          created: outcome.created,
        });
      }
    }

    // Diretório fora do ar e nenhuma outra forma de entrar: avisa, sem contar como falha.
    if (!failure && unavailable) {
      throw new ServiceUnavailableException({ message: 'directory_unavailable' });
    }
    await this.fail(key, ip, local?.userId ?? null, meta, failure ?? 'invalid_credentials');
    throw new UnauthorizedException({ message: 'invalid_credentials' });
  }

  private async succeed(
    userId: string,
    identityId: string,
    key: string,
    meta: Meta,
    details: Record<string, unknown>,
  ): Promise<LoginResult> {
    await this.throttle.registerSuccess(key);
    const session = await this.sessions.create(userId, meta, identityId);
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
    await recordAudit(this.prisma.client, {
      actorId: userId,
      action: details.breakGlass ? 'auth.break_glass_login' : 'auth.login',
      entityType: 'user',
      entityId: userId,
      after: details,
      ...meta,
    });
    const context = await this.sessions.resolve(session.token);
    return { session, mfa: context?.mfa ?? 'ok' };
  }

  private async fail(
    key: string,
    ip: string,
    userId: string | null,
    meta: Meta,
    reason: string,
  ): Promise<void> {
    await this.throttle.registerFailure(key, ip);
    await recordAudit(this.prisma.client, {
      actorId: userId,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: userId,
      after: { login: key, reason },
      ...meta,
    });
  }

  /** Conta desativada no diretório e já conhecida aqui: perde o acesso na hora. */
  private async disableKnownIdentity(providerId: string, uniqueId: string, meta: Meta) {
    const identity = await this.prisma.client.userIdentity.findUnique({
      where: { provider_subject: { provider: 'ldap', subject: ldapSubject(providerId, uniqueId) } },
    });
    if (identity && !identity.disabledAt) {
      await this.prisma.client.$transaction((tx) =>
        disableDirectoryIdentity(tx, identity.id, 'disabled', meta),
      );
    }
  }

  async logout(auth: AuthContext, meta: Meta): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
    await recordAudit(this.prisma.client, {
      actorId: auth.user.id,
      action: 'auth.logout',
      entityType: 'user',
      entityId: auth.user.id,
      ...meta,
    });
  }

  async me(auth: AuthContext) {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      include: {
        identities: { select: { provider: true } },
        totp: { select: { confirmedAt: true } },
        _count: { select: { webauthn: true } },
      },
    });
    const methods = [
      ...(user.totp?.confirmedAt ? ['totp' as const] : []),
      ...(user._count.webauthn > 0 ? ['webauthn' as const] : []),
    ];
    const base = {
      id: user.id,
      email: user.email,
      name: user.name,
      mfa: auth.mfa,
      mfaMethods: methods,
    };
    // Antes do segundo fator, nada além do necessário para a tela de MFA.
    if (auth.mfa !== 'ok') return { ...base, isOwner: false, providers: [], pages: [] };
    const pages = await this.prisma.client.page.findMany({
      where: auth.user.isOwner ? {} : { id: { in: [...auth.pageRoles.keys()] } },
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true },
    });
    return {
      ...base,
      isOwner: user.isOwner,
      isBreakGlass: user.isBreakGlass,
      providers: [...new Set(user.identities.map((i) => i.provider))],
      pages: pages.map((p) => ({
        ...p,
        role: auth.user.isOwner ? 'owner' : auth.pageRoles.get(p.id),
      })),
    };
  }

  async listSessions(auth: AuthContext) {
    const sessions = await this.prisma.client.session.findMany({
      where: { userId: auth.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastActiveAt: true },
    });
    return sessions.map((s) => ({ ...s, current: s.id === auth.sessionId }));
  }

  async revokeSession(auth: AuthContext, sessionId: string, meta: Meta): Promise<void> {
    const session = await this.prisma.client.session.findFirst({
      where: { id: sessionId, userId: auth.user.id },
    });
    if (!session) return;
    await this.sessions.revoke(sessionId);
    await recordAudit(this.prisma.client, {
      actorId: auth.user.id,
      action: 'auth.session_revoke',
      entityType: 'session',
      entityId: sessionId,
      ...meta,
    });
  }

  async changePassword(
    auth: AuthContext,
    input: { currentPassword: string; newPassword: string },
    meta: Meta,
  ): Promise<void> {
    const identity = await this.prisma.client.userIdentity.findFirst({
      where: { userId: auth.user.id, provider: 'local' },
    });
    if (!identity) throw new BadRequestException({ message: 'no_local_password' });
    if (!(await this.passwords.verify(identity.passwordHash, input.currentPassword))) {
      throw new BadRequestException({ message: 'invalid_current_password' });
    }
    this.passwords.assertPolicy(input.newPassword, auth.user.email);

    await this.prisma.client.userIdentity.update({
      where: { id: identity.id },
      data: { passwordHash: await this.passwords.hash(input.newPassword) },
    });
    await this.sessions.revokeAll(auth.user.id, auth.sessionId);
    await recordAudit(this.prisma.client, {
      actorId: auth.user.id,
      action: 'auth.password_change',
      entityType: 'user',
      entityId: auth.user.id,
      ...meta,
    });
  }
}
