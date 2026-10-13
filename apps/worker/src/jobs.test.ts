import { describe, expect, it, vi } from 'vitest';
import { type PrismaClient } from '@status-page/db';
import { purgeExpiredSessions } from './jobs.js';

describe('purgeExpiredSessions', () => {
  it('remove sessões expiradas ou revogadas há mais de 7 dias', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const prisma = { session: { deleteMany } } as unknown as PrismaClient;

    const removed = await purgeExpiredSessions(prisma, new Date('2026-10-11T00:00:00Z'));

    expect(removed).toBe(3);
    const cutoff = new Date('2026-10-04T00:00:00Z');
    expect(deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
  });
});
