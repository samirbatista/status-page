import { ForbiddenException, Injectable } from '@nestjs/common';
import { type Prisma } from '@status-page/db';
import { type AuditQuery, roleAtLeast } from '@status-page/shared';
import { type AuthContext, effectiveRole } from '../common/auth.types.js';
import { PrismaService } from '../infra/prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O Dono vê todo o log; Admins veem apenas o das páginas que administram
   * (e precisam informar `pageId`).
   */
  async list(auth: AuthContext, query: AuditQuery) {
    const where = this.where(auth, query);
    const rows = await this.prisma.client.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id : undefined };
  }

  async csv(auth: AuthContext, query: AuditQuery): Promise<string> {
    const rows = await this.prisma.client.auditLog.findMany({
      where: this.where(auth, query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10_000,
      include: { actor: { select: { email: true } } },
    });
    const header = [
      'created_at',
      'actor',
      'action',
      'entity_type',
      'entity_id',
      'page_id',
      'ip',
      'before',
      'after',
    ];
    const lines = rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.actor?.email ?? '',
        r.action,
        r.entityType,
        r.entityId ?? '',
        r.pageId ?? '',
        r.ip ?? '',
        r.before === null ? '' : JSON.stringify(r.before),
        r.after === null ? '' : JSON.stringify(r.after),
      ]
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  private where(auth: AuthContext, query: AuditQuery): Prisma.AuditLogWhereInput {
    if (!auth.user.isOwner) {
      const role = query.pageId ? effectiveRole(auth, query.pageId) : undefined;
      if (!role || !roleAtLeast(role, 'admin'))
        throw new ForbiddenException({ message: 'forbidden' });
    }
    return {
      ...(query.pageId ? { pageId: query.pageId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
  }
}

/** Escapa a célula e neutraliza injeção de fórmulas em planilhas. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
