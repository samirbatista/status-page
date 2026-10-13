import { getTranslations } from 'next-intl/server';
import { MaintenanceUpdateForm } from '@/components/admin/maintenance-forms';
import { LocalTime } from '@/components/local-time';
import { MaintenanceStatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/ui';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminMaintenance } from '@/lib/types';

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string; maintenanceId: string }>;
}) {
  const { locale, pageId, maintenanceId } = await params;
  const role = pageRole(await getMe(locale), pageId);
  const m = await adminApi<AdminMaintenance>(
    `/pages/${pageId}/maintenances/${maintenanceId}`,
    locale,
  );
  const t = await getTranslations();

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{m.title}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
            <MaintenanceStatusBadge status={m.status} />
            <LocalTime value={m.scheduledStart} /> – <LocalTime value={m.scheduledEnd} />
          </p>
          <p className="text-sm text-[var(--muted)]">
            {t('maintenance.affects')}:{' '}
            {m.components.map((c) => c.component.name).join(', ') || '—'}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {m.autoStart ? t('admin.maintenances.autoStart') : t('admin.maintenances.manualStart')}{' '}
            ·{' '}
            {m.autoComplete
              ? t('admin.maintenances.autoComplete')
              : t('admin.maintenances.manualComplete')}
          </p>
        </header>
        <Card title={t('admin.incidents.timeline')}>
          <ol className="flex flex-col gap-4">
            {m.updates.map((u) => (
              <li key={u.id} className="flex flex-col gap-1 border-l-2 border-[var(--border)] pl-3">
                <span className="text-sm font-semibold">{t(`maintenance.status.${u.status}`)}</span>
                <p className="whitespace-pre-line text-sm">
                  {u.body || t(`maintenance.defaultBody.${u.status}`)}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  <LocalTime value={u.createdAt} />
                  {u.createdBy
                    ? ` · ${u.createdBy.name}`
                    : ` · ${t('admin.maintenances.automatic')}`}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {can(role, 'operator') ? (
        <Card title={t('admin.maintenances.actions')}>
          <MaintenanceUpdateForm
            pageId={pageId}
            maintenanceId={maintenanceId}
            status={m.status}
            canDelete={can(role, 'admin')}
          />
        </Card>
      ) : null}
    </div>
  );
}
