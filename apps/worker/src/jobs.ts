import {
  LdapDirectory,
  type LdapConfig,
  providerConfig,
  type ProviderSyncResult,
  type SecretBox,
  syncLdapProvider,
} from '@status-page/core';
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

/** Sincroniza todos os provedores LDAP habilitados, um de cada vez. */
export async function syncAllLdapProviders(
  prisma: PrismaClient,
  secrets: SecretBox,
  directoryFor: (config: LdapConfig) => Pick<LdapDirectory, 'lookup'> = (c) => new LdapDirectory(c),
): Promise<(ProviderSyncResult & { provider: string })[]> {
  const providers = await prisma.ldapProvider.findMany({
    where: { enabled: true },
    include: { mappings: { select: { groupDn: true, pageId: true, role: true } } },
  });
  const results = [];
  for (const provider of providers) {
    let result: ProviderSyncResult;
    try {
      result = await syncLdapProvider(
        prisma,
        provider,
        directoryFor(providerConfig(provider, secrets)),
      );
    } catch (error) {
      // Erro inesperado (ex.: senha do bind ilegível): registra e segue para o próximo.
      const message = error instanceof Error ? error.message : String(error);
      await prisma.ldapProvider.update({
        where: { id: provider.id },
        data: { lastSyncAt: new Date(), lastSyncError: message.slice(0, 200) },
      });
      result = { checked: 0, updated: 0, disabled: 0, error: message };
    }
    results.push({ provider: provider.name, ...result });
  }
  return results;
}
