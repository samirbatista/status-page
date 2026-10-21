import { DeliveriesLog, type DeliveryRow } from '@/components/admin/notifications';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';

export default async function DeliveriesPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  const role = pageRole(await getMe(locale), pageId);
  const data = await adminApi<{ items: DeliveryRow[]; nextCursor?: string }>(
    `/pages/${pageId}/notification-deliveries?limit=50`,
    locale,
  );
  return <DeliveriesLog pageId={pageId} initial={data} canResend={can(role, 'admin')} />;
}
