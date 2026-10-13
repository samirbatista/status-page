import { type PrismaClient } from '@status-page/db';

/** Sessões expiradas ou revogadas são mantidas por este período para auditoria. */
export const SESSION_RETENTION_DAYS = 7;

export async function purgeExpiredSessions(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return count;
}
