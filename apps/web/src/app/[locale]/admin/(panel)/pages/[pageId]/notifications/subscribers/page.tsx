import { notFound } from 'next/navigation';
import { type SubscriberRow, SubscribersManager } from '@/components/admin/notifications';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';

export default async function SubscribersPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  if (!can(pageRole(await getMe(locale), pageId), 'admin')) notFound();
  const data = await adminApi<{ items: SubscriberRow[]; counts: Record<string, number> }>(
    `/pages/${pageId}/subscribers`,
    locale,
  );
  return <SubscribersManager pageId={pageId} data={data} />;
}
