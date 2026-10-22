import { notFound } from 'next/navigation';
import { IntegrationsManager } from '@/components/admin/integrations';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type IncidentTemplate, type InboundSource, type Structure } from '@/lib/types';

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  if (!can(pageRole(await getMe(locale), pageId), 'admin')) notFound();
  const [sources, structure, templates] = await Promise.all([
    adminApi<InboundSource[]>(`/pages/${pageId}/inbound-sources`, locale),
    adminApi<Structure>(`/pages/${pageId}/structure`, locale),
    adminApi<IncidentTemplate[]>(`/pages/${pageId}/templates`, locale),
  ]);
  return (
    <IntegrationsManager
      pageId={pageId}
      sources={sources}
      components={structure.components}
      templates={templates}
    />
  );
}
