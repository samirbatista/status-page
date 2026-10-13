import { getTranslations } from 'next-intl/server';
import { LocalTime } from '@/components/local-time';
import { IncidentStatusBadge } from '@/components/status-badge';
import { Card, EmptyState } from '@/components/ui/ui';
import { Link } from '@/i18n/navigation';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminIncident, type Paginated } from '@/lib/types';

export default async function IncidentsPage({
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
  const list = await adminApi<Paginated<AdminIncident>>(
    `/pages/${pageId}/incidents?${query}`,
    locale,
  );
  const t = await getTranslations('admin.incidents');
  const base = `/admin/pages/${pageId}/incidents`;

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
          {list.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <Link href={`${base}/${i.id}`} className="font-medium hover:underline">
                  {i.title}
                </Link>
                <p className="text-xs text-[var(--muted)]">
                  <LocalTime value={i.startedAt} />
                  {i.backfilled ? ` · ${t('backfilled')}` : null}
                </p>
              </div>
              <IncidentStatusBadge status={i.status} />
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
