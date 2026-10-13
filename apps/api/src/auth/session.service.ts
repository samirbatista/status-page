import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type Role } from '@status-page/shared';
import { API_ENV, type ApiEnv } from '../env.js';
import { PrismaService } from '../infra/prisma.service.js';
import { type AuthContext } from '../common/auth.types.js';

export const SESSION_COOKIE = 'sp_session';

/** Atualiza `lastActiveAt` no máximo uma vez por minuto por sessão. */
const TOUCH_INTERVAL_MS = 60_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  get maxAgeMs(): number {
    return this.env.SESSION_MAX_HOURS * 3_600_000;
  }

  async create(
    userId: string,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<{ token: string; id: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.maxAgeMs);
    const session = await this.prisma.client.session.create({
      data: {
        userId,
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
      include: { user: { include: { pageRoles: true } } },
    });
    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.lastActiveAt.getTime() + this.env.SESSION_IDLE_MINUTES * 60_000 <= now ||
      session.user.disabledAt
    ) {
      return null;
    }

    if (now - session.lastActiveAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date(now) },
      });
    }

    const { user } = session;
    return {
      sessionId: session.id,
      user: { id: user.id, email: user.email, name: user.name, isOwner: user.isOwner },
      pageRoles: new Map(user.pageRoles.map((r) => [r.pageId, r.role as Role])),
    };
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
