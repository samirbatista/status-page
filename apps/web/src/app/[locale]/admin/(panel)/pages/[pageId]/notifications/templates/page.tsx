import { notFound } from 'next/navigation';
import { type TemplatesData, TemplatesEditor } from '@/components/admin/notifications';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';

export default async function NotificationTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  if (!can(pageRole(await getMe(locale), pageId), 'admin')) notFound();
  const data = await adminApi<TemplatesData>(`/pages/${pageId}/notification-templates`, locale);
  return <TemplatesEditor pageId={pageId} data={data} />;
}
