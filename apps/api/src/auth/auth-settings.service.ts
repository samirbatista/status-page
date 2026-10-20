import { BadRequestException, Injectable } from '@nestjs/common';
import { recordAudit, type AuditContext } from '@status-page/core';
import { type Prisma } from '@status-page/db';
import { authSettingsSchema, DEFAULT_AUTH_SETTINGS, type AuthSettings } from '@status-page/shared';
import { PrismaService } from '../infra/prisma.service.js';

const KEY = 'auth.policy';
/** A política é lida a cada requisição autenticada; um cache curto evita ir ao banco sempre. */
const CACHE_MS = 5_000;

@Injectable()
export class AuthSettingsService {
  private cache: { value: AuthSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AuthSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.prisma.client.setting.findUnique({ where: { key: KEY } });
    const parsed = authSettingsSchema.safeParse(row?.value);
    const value = parsed.success ? parsed.data : DEFAULT_AUTH_SETTINGS;
    this.cache = { value, at: Date.now() };
    return value;
  }

  /** Descarta o cache (ex.: depois de limpar o banco nos testes). */
  invalidate(): void {
    this.cache = null;
  }

  async update(input: AuthSettings, audit: AuditContext): Promise<AuthSettings> {
    const before = await this.get();
    if (input.mfa.mode === 'roles' && input.mfa.roles.length === 0) {
      throw new BadRequestException({ message: 'mfa_roles_required' });
    }
    if (input.localLogin === 'break_glass_only') {
      // Sem uma conta de emergência ativa, restringir o login local pode trancar todos do lado de fora.
      const breakGlass = await this.prisma.client.user.count({
        where: {
          isBreakGlass: true,
          isOwner: true,
          disabledAt: null,
          identities: { some: { provider: 'local', passwordHash: { not: null } } },
        },
      });
      if (breakGlass === 0) throw new BadRequestException({ message: 'break_glass_required' });
    }
    const value = { ...input, mfa: { ...input.mfa, roles: [...new Set(input.mfa.roles)] } };
    await this.prisma.client.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: KEY },
        create: { key: KEY, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'settings.auth_update',
        entityType: 'setting',
        entityId: KEY,
        before,
        after: value,
      });
    });
    this.cache = null;
    return value;
  }
}
