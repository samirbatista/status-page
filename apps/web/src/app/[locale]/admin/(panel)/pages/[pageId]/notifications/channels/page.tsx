import { notFound } from 'next/navigation';
import { ChannelsManager, type TeamChannel } from '@/components/admin/notifications';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  if (!can(pageRole(await getMe(locale), pageId), 'admin')) notFound();
  const channels = await adminApi<TeamChannel[]>(`/pages/${pageId}/notification-channels`, locale);
  return <ChannelsManager pageId={pageId} channels={channels} />;
}
