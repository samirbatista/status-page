import { TemplatesManager } from '@/components/admin/templates-manager';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type IncidentTemplate, type Structure } from '@/lib/types';

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  const role = pageRole(await getMe(locale), pageId);
  const [templates, structure] = await Promise.all([
    adminApi<IncidentTemplate[]>(`/pages/${pageId}/templates`, locale),
    adminApi<Structure>(`/pages/${pageId}/structure`, locale),
  ]);
  return (
    <TemplatesManager
      pageId={pageId}
      templates={templates}
      components={structure.components}
      canEdit={can(role, 'admin')}
    />
  );
}
