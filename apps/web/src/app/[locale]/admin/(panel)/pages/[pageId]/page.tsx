import { getTranslations } from 'next-intl/server';
import { ComponentStatusSelect } from '@/components/admin/component-status-select';
import { LocalTime } from '@/components/local-time';
import { IncidentStatusBadge, MaintenanceStatusBadge } from '@/components/status-badge';
import { Card, EmptyState } from '@/components/ui/ui';
import { Link } from '@/i18n/navigation';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import {
  type AdminIncident,
  type AdminMaintenance,
  type Paginated,
  type Structure,
} from '@/lib/types';

export default async function PageOverview({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  const me = await getMe(locale);
  const role = pageRole(me, pageId);
  const [incidents, scheduled, running, structure] = await Promise.all([
    adminApi<Paginated<AdminIncident>>(`/pages/${pageId}/incidents?active=true&limit=50`, locale),
    adminApi<Paginated<AdminMaintenance>>(
      `/pages/${pageId}/maintenances?status=scheduled&limit=10`,
      locale,
    ),
    adminApi<Paginated<AdminMaintenance>>(
      `/pages/${pageId}/maintenances?status=in_progress&limit=10`,
      locale,
    ),
    adminApi<Structure>(`/pages/${pageId}/structure`, locale),
  ]);
  const t = await getTranslations('admin.overview');
  const base = `/admin/pages/${pageId}`;
  const maintenances = [...running.items, ...scheduled.items];
  const isOperator = can(role, 'operator');

  return (
    <div className="grid gap-6">
      <Card
        title={t('activeIncidents')}
        actions={
          isOperator ? (
            <Link href={`${base}/incidents/new`} className="text-sm text-brand hover:underline">
              + {t('newIncident')}
            </Link>
          ) : null
        }
      >
        {incidents.items.length === 0 ? (
          <EmptyState>{t('noActiveIncidents')}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {incidents.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`${base}/incidents/${i.id}`} className="font-medium hover:underline">
                  {i.title}
                </Link>
                <IncidentStatusBadge status={i.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('maintenances')}>
        {maintenances.length === 0 ? (
          <EmptyState>{t('noMaintenances')}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {maintenances.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Link
                    href={`${base}/maintenances/${m.id}`}
                    className="font-medium hover:underline"
                  >
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
      </Card>

      <Card title={t('components')}>
        {structure.components.length === 0 ? (
          <EmptyState>{t('noComponents')}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {structure.components.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">{c.name}</span>
                <ComponentStatusSelect
                  pageId={pageId}
                  componentId={c.id}
                  name={c.name}
                  status={c.status}
                  disabled={!isOperator}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
