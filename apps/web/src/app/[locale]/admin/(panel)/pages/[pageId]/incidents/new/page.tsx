import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { IncidentForm } from '@/components/admin/incident-form';
import { Card } from '@/components/ui/ui';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type IncidentTemplate, type Structure } from '@/lib/types';

export default async function NewIncidentPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  if (!can(pageRole(await getMe(locale), pageId), 'operator')) notFound();
  const [structure, templates] = await Promise.all([
    adminApi<Structure>(`/pages/${pageId}/structure`, locale),
    adminApi<IncidentTemplate[]>(`/pages/${pageId}/templates`, locale),
  ]);
  const t = await getTranslations('admin.incidents');
  return (
    <Card title={t('new')}>
      <IncidentForm pageId={pageId} components={structure.components} templates={templates} />
    </Card>
  );
}
