import { type AuthSettings } from '@status-page/shared';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AuthPolicyForm, LdapProviderList } from '@/components/admin/auth-settings';
import { getMe } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type LdapProvider } from '@/lib/types';

/** Autenticação da instalação (Dono): política de MFA, login local e provedores LDAP. */
export default async function AuthSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const me = await getMe(locale);
  if (!me.isOwner) notFound();
  const [settings, providers] = await Promise.all([
    adminApi<AuthSettings>('/auth/settings', locale),
    adminApi<LdapProvider[]>('/ldap/providers', locale),
  ]);
  const t = await getTranslations('admin.authSettings');
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('heading')}</h1>
      <AuthPolicyForm settings={settings} />
      <LdapProviderList providers={providers} />
    </div>
  );
}
