import { METRIC_RANGES } from '@status-page/shared';
import { getTranslations } from 'next-intl/server';
import { MonitorForm, MonitorStateBadge, RecentChecks } from '@/components/admin/monitors';
import { LocalTime } from '@/components/local-time';
import { MetricsChart } from '@/components/metrics-chart';
import { Card, cx } from '@/components/ui/ui';
import { Link } from '@/i18n/navigation';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import {
  type IncidentTemplate,
  type MetricRange,
  type Monitor,
  type MonitorResults,
  type Structure,
} from '@/lib/types';

export default async function MonitorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; pageId: string; monitorId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { locale, pageId, monitorId } = await params;
  const { range: rawRange } = await searchParams;
  const range: MetricRange = (METRIC_RANGES as readonly string[]).includes(rawRange ?? '')
    ? (rawRange as MetricRange)
    : 'day';
  const role = pageRole(await getMe(locale), pageId);
  const [monitor, results, structure, templates] = await Promise.all([
    adminApi<Monitor>(`/pages/${pageId}/monitors/${monitorId}`, locale),
    adminApi<MonitorResults>(
      `/pages/${pageId}/monitors/${monitorId}/results?range=${range}`,
      locale,
    ),
    adminApi<Structure>(`/pages/${pageId}/structure`, locale),
    adminApi<IncidentTemplate[]>(`/pages/${pageId}/templates`, locale),
  ]);
  const t = await getTranslations();
  const base = `/admin/pages/${pageId}/monitors/${monitorId}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <Link
            href={`/admin/pages/${pageId}/monitors`}
            className="text-sm text-brand hover:underline"
          >
            ← {t('admin.monitors.heading')}
          </Link>
          <h2 className="text-xl font-semibold">{monitor.name}</h2>
          <p className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
            <MonitorStateBadge monitor={monitor} />
            <span>{monitor.target}</span>
            {monitor.lastCheckAt ? (
              <span>
                {t('admin.monitors.lastCheck')}: <LocalTime value={monitor.lastCheckAt} />
              </span>
            ) : null}
          </p>
          {monitor.lastError ? (
            <p className="text-sm text-status-major_outage">{monitor.lastError}</p>
          ) : null}
        </header>
        <Card
          title={t('metrics.heading')}
          actions={
            <nav className="flex gap-1 text-sm">
              {METRIC_RANGES.map((r) => (
                <Link
                  key={r}
                  href={`${base}?range=${r}`}
                  className={cx(
                    'rounded px-2 py-1',
                    r === range ? 'bg-brand text-white' : 'hover:bg-[var(--background)]',
                  )}
                >
                  {t(`metrics.range.${r}`)}
                </Link>
              ))}
            </nav>
          }
        >
          <MetricsChart series={results} />
        </Card>
        {can(role, 'admin') ? (
          <Card title={t('admin.monitors.settings')}>
            <MonitorForm
              pageId={pageId}
              monitor={monitor}
              components={structure.components}
              templates={templates}
            />
          </Card>
        ) : null}
      </div>
      <Card title={t('admin.monitors.recent')}>
        <RecentChecks items={results.recent} />
      </Card>
    </div>
  );
}
