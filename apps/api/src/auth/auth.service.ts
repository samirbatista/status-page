import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { recordAudit } from '@status-page/core';
import { type LoginInput } from '@status-page/shared';
import { PrismaService } from '../infra/prisma.service.js';
import { tooManyRequests } from '../common/rate-limit.service.js';
import { type AuthContext } from '../common/auth.types.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

interface Meta {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly throttle: LoginThrottleService,
    private readonly sessions: SessionService,
  ) {}

  async login(input: LoginInput, meta: Meta) {
    const ip = meta.ip ?? 'unknown';
    const lockedFor = await this.throttle.lockedFor(input.email, ip);
    if (lockedFor > 0) throw tooManyRequests(lockedFor);

    const identity = await this.prisma.client.userIdentity.findUnique({
      where: { provider_subject: { provider: 'local', subject: input.email } },
      include: { user: true },
    });
    const valid = await this.passwords.verify(identity?.passwordHash, input.password);

    if (!identity || !valid || identity.user.disabledAt) {
      await this.throttle.registerFailure(input.email, ip);
      await recordAudit(this.prisma.client, {
        actorId: identity?.userId ?? null,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: identity?.userId ?? null,
        after: { email: input.email },
        ...meta,
      });
      throw new UnauthorizedException({ message: 'invalid_credentials' });
    }

    await this.throttle.registerSuccess(input.email);
    const session = await this.sessions.create(identity.userId, meta);
    await this.prisma.client.user.update({
      where: { id: identity.userId },
      data: { lastLoginAt: new Date() },
    });
    await recordAudit(this.prisma.client, {
      actorId: identity.userId,
      action: 'auth.login',
      entityType: 'user',
      entityId: identity.userId,
      ...meta,
    });
    return session;
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
      include: { identities: { select: { provider: true } } },
    });
    const pages = await this.prisma.client.page.findMany({
      where: auth.user.isOwner ? {} : { id: { in: [...auth.pageRoles.keys()] } },
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isOwner: user.isOwner,
      providers: user.identities.map((i) => i.provider),
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
