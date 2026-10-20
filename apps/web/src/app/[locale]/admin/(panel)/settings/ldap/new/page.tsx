import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LdapProviderForm } from '@/components/admin/ldap-provider';
import { Link } from '@/i18n/navigation';
import { getMe } from '@/lib/admin';

export default async function NewLdapProviderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const me = await getMe(locale);
  if (!me.isOwner) notFound();
  const t = await getTranslations('admin.ldap');
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/admin/settings/auth" className="text-sm text-brand">
          ← {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('newHeading')}</h1>
      </div>
      <LdapProviderForm />
    </div>
  );
}
