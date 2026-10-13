import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DomainsManager } from '@/components/admin/domains-manager';
import { PageSettingsForm } from '@/components/admin/page-settings-form';
import { Card } from '@/components/ui/ui';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminPage, type DomainInfo } from '@/lib/types';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  const me = await getMe(locale);
  if (!can(pageRole(me, pageId), 'admin')) notFound();
  const [page, domains] = await Promise.all([
    adminApi<AdminPage>(`/pages/${pageId}`, locale),
    adminApi<DomainInfo[]>(`/pages/${pageId}/domains`, locale),
  ]);
  const t = await getTranslations('admin');
  return (
    <div className="grid gap-6">
      <Card title={t('settings.heading')}>
        <PageSettingsForm page={page} isOwner={me.isOwner} />
      </Card>
      <Card title={t('domains.heading')}>
        <DomainsManager pageId={pageId} domains={domains} isOwner={me.isOwner} />
      </Card>
    </div>
  );
}
