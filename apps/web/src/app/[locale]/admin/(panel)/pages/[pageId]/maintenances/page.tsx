import { getTranslations } from 'next-intl/server';
import { LocalTime } from '@/components/local-time';
import { MaintenanceStatusBadge } from '@/components/status-badge';
import { Card, EmptyState } from '@/components/ui/ui';
import { Link } from '@/i18n/navigation';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminMaintenance, type Paginated } from '@/lib/types';

export default async function MaintenancesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; pageId: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { locale, pageId } = await params;
  const { cursor } = await searchParams;
  const role = pageRole(await getMe(locale), pageId);
  const query = new URLSearchParams({ limit: '25', ...(cursor ? { cursor } : {}) });
  const list = await adminApi<Paginated<AdminMaintenance>>(
    `/pages/${pageId}/maintenances?${query}`,
    locale,
  );
  const t = await getTranslations('admin.maintenances');
  const base = `/admin/pages/${pageId}/maintenances`;

  return (
    <Card
      title={t('heading')}
      actions={
        can(role, 'operator') ? (
          <Link href={`${base}/new`} className="text-sm text-brand hover:underline">
            + {t('new')}
          </Link>
        ) : null
      }
    >
      {list.items.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {list.items.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <Link href={`${base}/${m.id}`} className="font-medium hover:underline">
                  {m.title}
                </Link>
                <p className="text-xs text-[var(--muted)]">
                  <LocalTime value={m.scheduledStart} /> – <LocalTime value={m.scheduledEnd} />
                </p>
              </div>
              <MaintenanceStatusBadge status={m.status} />
            </li>
          ))}
        </ul>
      )}
      {list.nextCursor ? (
        <div className="pt-4 text-right">
          <Link
            href={`${base}?cursor=${list.nextCursor}`}
            className="text-sm text-brand hover:underline"
          >
            {t('older')} →
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
