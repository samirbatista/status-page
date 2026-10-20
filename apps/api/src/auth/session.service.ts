import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { mfaRequiredFor, type Role } from '@status-page/shared';
import { API_ENV, type ApiEnv } from '../env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { type AuthContext, type MfaStage } from '../common/auth.types.js';
import { AuthSettingsService } from './auth-settings.service.js';

export const SESSION_COOKIE = 'sp_session';

/** Atualiza `lastActiveAt` no máximo uma vez por minuto por sessão. */
const TOUCH_INTERVAL_MS = 60_000;
/** Tempo para confirmar o segundo fator depois da senha. */
export const MFA_PENDING_TTL_MS = 10 * 60_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AuthSettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  get maxAgeMs(): number {
    return this.env.SESSION_MAX_HOURS * 3_600_000;
  }

  async create(
    userId: string,
    meta: { ip: string | null; userAgent: string | null },
    identityId: string | null = null,
  ): Promise<{ token: string; id: string; expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + this.maxAgeMs);
    const session = await this.prisma.client.session.create({
      data: {
        userId,
        identityId,
        tokenHash: hashToken(token),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
        expiresAt,
      },
    });
    return { token, id: session.id, expiresAt };
  }

  /** Resolve o token do cookie em um contexto autenticado, ou `null` se inválido. */
  async resolve(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        identity: { select: { disabledAt: true } },
        user: {
          include: {
            pageRoles: true,
            totp: { select: { confirmedAt: true } },
            _count: { select: { webauthn: true } },
          },
        },
      },
    });
    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.lastActiveAt.getTime() + this.env.SESSION_IDLE_MINUTES * 60_000 <= now ||
      session.user.disabledAt ||
      // A conta do diretório usada no login foi desativada.
      session.identity?.disabledAt
    ) {
      return null;
    }

    const { user } = session;
    const pageRoles = new Map(user.pageRoles.map((r) => [r.pageId, r.role as Role]));
    const hasFactor = Boolean(user.totp?.confirmedAt) || user._count.webauthn > 0;
    let mfa: MfaStage = 'ok';
    if (hasFactor && !session.mfaVerified) {
      if (session.createdAt.getTime() + MFA_PENDING_TTL_MS <= now) return null;
      mfa = 'pending';
    } else if (!hasFactor) {
      const policy = (await this.settings.get()).mfa;
      if (mfaRequiredFor(policy, { isOwner: user.isOwner, roles: pageRoles.values() })) {
        mfa = 'enroll';
      }
    }

    if (now - session.lastActiveAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date(now) },
      });
    }

    return {
      sessionId: session.id,
      mfa,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isOwner: user.isOwner,
        isBreakGlass: user.isBreakGlass,
      },
      pageRoles,
    };
  }

  /**
   * O segundo fator foi confirmado: marca a sessão e troca o token, para que um
   * token obtido antes do MFA (fixação de sessão) não ganhe o acesso completo.
   */
  async completeMfa(sessionId: string): Promise<string> {
    const token = newToken();
    await this.prisma.client.session.update({
      where: { id: sessionId },
      data: { mfaVerified: true, tokenHash: hashToken(token), lastActiveAt: new Date() },
    });
    return token;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Encerra todas as sessões do usuário, exceto (opcionalmente) a atual. */
  async revokeAll(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }
}
