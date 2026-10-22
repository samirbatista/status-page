import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type AuditContext, recordAudit } from '@status-page/core';
import {
  API_TOKEN_PREFIX,
  type ApiTokenCreateInput,
  type Role,
  ROLES,
  roleAtLeast,
} from '@status-page/shared';
import { type AuthContext } from '../common/auth.types.js';
import { PrismaService } from '../infra/prisma.service.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
/** Atualiza "último uso" no máximo uma vez por minuto. */
const TOUCH_INTERVAL_MS = 60_000;

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  prefix: true,
  role: true,
  expiresAt: true,
  lastUsedAt: true,
  lastUsedIp: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

function minRole(a: Role, b: Role): Role {
  return ROLES.indexOf(a) <= ROLES.indexOf(b) ? a : b;
}

/**
 * Tokens da API administrativa: valem para uma página, com um papel (Leitor,
 * Operador ou Admin) e validade opcional. O token age em nome de quem o criou e
 * nunca passa do papel atual dessa pessoa na página.
 */
@Injectable()
export class ApiTokensService {
  constructor(private readonly prisma: PrismaService) {}

  list(pageId: string) {
    return this.prisma.client.apiToken.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_FIELDS,
    });
  }

  async create(pageId: string, input: ApiTokenCreateInput, auth: AuthContext, audit: AuditContext) {
    const creatorRole = auth.user.isOwner ? 'owner' : auth.pageRoles.get(pageId);
    if (!creatorRole || !roleAtLeast(creatorRole, input.role)) {
      throw new ForbiddenException({ message: 'forbidden' });
    }
    const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const created = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.apiToken.create({
        data: {
          pageId,
          name: input.name,
          role: input.role,
          tokenHash: hash(token),
          prefix: token.slice(0, API_TOKEN_PREFIX.length + 6),
          expiresAt: input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 86_400_000)
            : null,
          createdById: auth.user.id,
        },
        select: PUBLIC_FIELDS,
      });
      await recordAudit(tx, {
        ...audit,
        action: 'api_token.create',
        entityType: 'api_token',
        entityId: row.id,
        pageId,
        after: { name: row.name, role: row.role, expiresAt: row.expiresAt },
      });
      return row;
    });
    // O valor só aparece aqui; depois, apenas o prefixo.
    return { ...created, token };
  }

  async revoke(pageId: string, tokenId: string, audit: AuditContext): Promise<void> {
    const token = await this.prisma.client.apiToken.findFirst({ where: { id: tokenId, pageId } });
    if (!token) throw new NotFoundException({ message: 'api_token_not_found' });
    if (token.revokedAt) return;
    await this.prisma.client.$transaction(async (tx) => {
      await tx.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
      await recordAudit(tx, {
        ...audit,
        action: 'api_token.revoke',
        entityType: 'api_token',
        entityId: tokenId,
        pageId,
        before: { name: token.name, role: token.role },
      });
    });
  }

  /** Contexto de uma requisição com `Authorization: Bearer`, ou `null` se inválido. */
  async resolve(token: string, ip: string | null): Promise<AuthContext | null> {
    if (!token.startsWith(API_TOKEN_PREFIX) || token.length > 200) return null;
    const row = await this.prisma.client.apiToken.findUnique({
      where: { tokenHash: hash(token) },
      include: {
        createdBy: { include: { pageRoles: true } },
      },
    });
    const now = Date.now();
    if (
      !row ||
      row.revokedAt ||
      (row.expiresAt && row.expiresAt.getTime() <= now) ||
      row.createdBy.disabledAt
    ) {
      return null;
    }
    const { createdBy: user } = row;
    const creatorRole: Role | undefined = user.isOwner
      ? 'owner'
      : (user.pageRoles.find((r) => r.pageId === row.pageId)?.role as Role | undefined);
    // Quem criou perdeu o acesso à página: o token deixa de valer.
    if (!creatorRole) return null;

    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.client.apiToken.update({
        where: { id: row.id },
        data: { lastUsedAt: new Date(now), lastUsedIp: ip },
      });
    }
    return {
      sessionId: `api-token:${row.id}`,
      mfa: 'ok',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        // O token nunca tem poderes de Dono, mesmo criado por um.
        isOwner: false,
        isBreakGlass: false,
      },
      pageRoles: new Map([[row.pageId, minRole(row.role as Role, creatorRole)]]),
      apiToken: { id: row.id, name: row.name, prefix: row.prefix },
    };
  }
}
