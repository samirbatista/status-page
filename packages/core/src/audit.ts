import { type Prisma } from '@status-page/db';
import { type Db } from './db.js';

export interface AuditContext {
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry extends AuditContext {
  /** Verbo no formato `<entidade>.<ação>`, ex.: `incident.create`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  pageId?: string | null;
  before?: unknown;
  after?: unknown;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  // Normaliza Date, BigInt etc. para o formato que será persistido.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      pageId: entry.pageId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 512) ?? null,
    },
  });
}
