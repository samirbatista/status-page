import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type AuditContext, recordAudit } from '@status-page/core';
import { type Db } from '@status-page/core';
import { type Role } from '@status-page/shared';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { PrismaService } from '../infra/prisma.service.js';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  isOwner: true,
  isBreakGlass: true,
  disabledAt: true,
  lastLoginAt: true,
  createdAt: true,
  identities: { select: { provider: true } },
  pageRoles: { select: { pageId: true, role: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  list() {
    return this.prisma.client.user.findMany({ orderBy: { name: 'asc' }, select: USER_SELECT });
  }

  async create(
    input: { email: string; name: string; password: string; isOwner: boolean },
    audit: AuditContext,
  ) {
    this.passwords.assertPolicy(input.password, input.email);
    if (await this.prisma.client.user.findUnique({ where: { email: input.email } })) {
      throw new ConflictException({ message: 'email_taken' });
    }
    const passwordHash = await this.passwords.hash(input.password);
    return this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          isOwner: input.isOwner,
          identities: { create: { provider: 'local', subject: input.email, passwordHash } },
        },
        select: USER_SELECT,
      });
      await recordAudit(tx, {
        ...audit,
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        after: { email: user.email, name: user.name, isOwner: user.isOwner },
      });
      return user;
    });
  }

  async update(
    userId: string,
    input: { name?: string; isOwner?: boolean; disabled?: boolean },
    audit: AuditContext,
  ) {
    const before = await this.find(userId);
    const losesOwner =
      before.isOwner &&
      (input.isOwner === false || (input.disabled === true && !before.disabledAt));
    if (losesOwner) await this.assertNotLastOwner(this.prisma.client, userId);

    const user = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isOwner !== undefined ? { isOwner: input.isOwner } : {}),
          ...(input.disabled !== undefined
            ? { disabledAt: input.disabled ? (before.disabledAt ?? new Date()) : null }
            : {}),
        },
        select: USER_SELECT,
      });
      await recordAudit(tx, {
        ...audit,
        action: 'user.update',
        entityType: 'user',
        entityId: userId,
        before: {
          name: before.name,
          isOwner: before.isOwner,
          disabled: Boolean(before.disabledAt),
        },
        after: {
          name: updated.name,
          isOwner: updated.isOwner,
          disabled: Boolean(updated.disabledAt),
        },
      });
      return updated;
    });
    if (input.disabled) await this.sessions.revokeAll(userId);
    return user;
  }

  async resetPassword(userId: string, password: string, audit: AuditContext): Promise<void> {
    const user = await this.find(userId);
    this.passwords.assertPolicy(password, user.email);
    const identity = await this.prisma.client.userIdentity.findFirst({
      where: { userId, provider: 'local' },
    });
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.client.$transaction(async (tx) => {
      if (identity) {
        await tx.userIdentity.update({ where: { id: identity.id }, data: { passwordHash } });
      } else {
        await tx.userIdentity.create({
          data: { userId, provider: 'local', subject: user.email, passwordHash },
        });
      }
      await recordAudit(tx, {
        ...audit,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: userId,
      });
    });
    await this.sessions.revokeAll(userId);
  }

  // --- Equipe da página -----------------------------------------------------

  async team(pageId: string) {
    const roles = await this.prisma.client.userPageRole.findMany({
      where: { pageId },
      include: { user: { select: { id: true, email: true, name: true, disabledAt: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return roles.map((r) => ({ ...r.user, role: r.role, manual: r.manual }));
  }

  /** Usuários que podem ser adicionados à equipe (busca por nome ou e-mail). */
  directory(query: string) {
    return this.prisma.client.user.findMany({
      where: {
        disabledAt: null,
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 20,
      orderBy: { name: 'asc' },
      select: { id: true, email: true, name: true },
    });
  }

  async setRole(pageId: string, userId: string, role: Exclude<Role, 'owner'>, audit: AuditContext) {
    await this.find(userId);
    await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.userPageRole.findUnique({
        where: { userId_pageId: { userId, pageId } },
      });
      await tx.userPageRole.upsert({
        where: { userId_pageId: { userId, pageId } },
        create: { userId, pageId, role, manual: true },
        update: { role, manual: true },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'page_role.set',
        entityType: 'user',
        entityId: userId,
        pageId,
        before: before ? { role: before.role } : null,
        after: { role },
      });
    });
  }

  async removeRole(pageId: string, userId: string, audit: AuditContext): Promise<void> {
    const before = await this.prisma.client.userPageRole.findUnique({
      where: { userId_pageId: { userId, pageId } },
    });
    if (!before) throw new NotFoundException({ message: 'role_not_found' });
    await this.prisma.client.$transaction(async (tx) => {
      await tx.userPageRole.delete({ where: { userId_pageId: { userId, pageId } } });
      await recordAudit(tx, {
        ...audit,
        action: 'page_role.remove',
        entityType: 'user',
        entityId: userId,
        pageId,
        before: { role: before.role },
      });
    });
  }

  private async find(userId: string) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ message: 'user_not_found' });
    return user;
  }

  private async assertNotLastOwner(db: Db, userId: string): Promise<void> {
    const others = await db.user.count({
      where: { isOwner: true, disabledAt: null, id: { not: userId } },
    });
    if (others === 0) throw new BadRequestException({ message: 'last_owner' });
  }
}
