import { MonitorsManager } from '@/components/admin/monitors';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type IncidentTemplate, type Monitor, type Structure } from '@/lib/types';

export default async function MonitorsPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  const role = pageRole(await getMe(locale), pageId);
  const [monitors, structure, templates] = await Promise.all([
    adminApi<Monitor[]>(`/pages/${pageId}/monitors`, locale),
    adminApi<Structure>(`/pages/${pageId}/structure`, locale),
    adminApi<IncidentTemplate[]>(`/pages/${pageId}/templates`, locale),
  ]);
  return (
    <MonitorsManager
      pageId={pageId}
      monitors={monitors}
      components={structure.components}
      templates={templates}
      canEdit={can(role, 'admin')}
    />
  );
}
