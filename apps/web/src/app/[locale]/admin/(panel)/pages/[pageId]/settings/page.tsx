import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PageSettingsForm } from '@/components/admin/page-settings-form';
import { Card } from '@/components/ui/ui';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminPage } from '@/lib/types';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  const me = await getMe(locale);
  if (!can(pageRole(me, pageId), 'admin')) notFound();
  const page = await adminApi<AdminPage>(`/pages/${pageId}`, locale);
  const t = await getTranslations('admin.settings');
  return (
    <Card title={t('heading')}>
      <PageSettingsForm page={page} isOwner={me.isOwner} />
    </Card>
  );
}
