import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MaintenanceForm } from '@/components/admin/maintenance-forms';
import { Card } from '@/components/ui/ui';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type Structure } from '@/lib/types';

export default async function NewMaintenancePage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  if (!can(pageRole(await getMe(locale), pageId), 'operator')) notFound();
  const structure = await adminApi<Structure>(`/pages/${pageId}/structure`, locale);
  const t = await getTranslations('admin.maintenances');
  return (
    <Card title={t('new')}>
      <MaintenanceForm pageId={pageId} components={structure.components} />
    </Card>
  );
}
