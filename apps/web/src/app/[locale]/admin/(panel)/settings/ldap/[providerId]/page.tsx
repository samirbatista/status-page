import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import {
  LdapLoginTest,
  LdapMappings,
  LdapProviderActions,
  LdapProviderForm,
} from '@/components/admin/ldap-provider';
import { Link } from '@/i18n/navigation';
import { getMe } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type LdapProviderDetail } from '@/lib/types';

export default async function LdapProviderPage({
  params,
}: {
  params: Promise<{ locale: string; providerId: string }>;
}) {
  const { locale, providerId } = await params;
  const me = await getMe(locale);
  if (!me.isOwner) notFound();
  const provider = await adminApi<LdapProviderDetail>(`/ldap/providers/${providerId}`, locale);
  const t = await getTranslations('admin.ldap');
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/admin/settings/auth" className="text-sm text-brand">
          ← {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold">{provider.name}</h1>
        <p className="text-sm text-[var(--muted)]">{t('usersCount', { count: provider.users })}</p>
      </div>
      <LdapProviderForm key={provider.id} provider={provider} />
      <LdapMappings provider={provider} pages={me.pages} />
      <LdapLoginTest providerId={provider.id} />
      <LdapProviderActions provider={provider} />
    </div>
  );
}
