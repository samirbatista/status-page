import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { type PublicIncident, type PublicMaintenance, type PublicSummary } from '@/lib/types';
import { LocalTime } from '../local-time';
import {
  ComponentStatusBadge,
  IncidentStatusBadge,
  MaintenanceStatusBadge,
  STATUS_BG,
} from '../status-badge';
import { cx } from '../ui/ui';
import { ThemedShell } from './themed-shell';
import { UptimeBar } from './uptime-bar';
import { Timeline, useIncidentTimeline, useMaintenanceTimeline } from './updates-timeline';

export function StatusPageView({ summary }: { summary: PublicSummary }) {
  const t = useTranslations();
  const { page } = summary;
  const ungrouped = summary.components.filter((c) => c.groupId === null);

  return (
    <ThemedShell page={page}>
      <section
        data-status={summary.status}
        className={cx(
          'rounded-lg px-6 py-4 text-lg font-medium text-white',
          STATUS_BG[summary.status],
        )}
      >
        {t(`overall.${summary.status}`)}
      </section>

      {summary.activeIncidents.map((incident) => (
        <IncidentCard
          key={incident.id}
          incident={incident}
          slug={page.slug}
          timeZone={page.timezone}
        />
      ))}

      {summary.maintenances.map((m) => (
        <MaintenanceCard key={m.id} maintenance={m} slug={page.slug} timeZone={page.timezone} />
      ))}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        {summary.components.length === 0 ? (
          <p className="px-6 py-4 text-[var(--muted)]">{t('home.noComponents')}</p>
        ) : null}
        {summary.groups.map((group) => {
          const items = summary.components.filter((c) => c.groupId === group.id);
          if (items.length === 0) return null;
          const worst = items.map((c) => c.status);
          return (
            <details
              key={group.id}
              open={!group.collapsed}
              className="border-b border-[var(--border)] last:border-b-0"
            >
              <summary className="flex cursor-pointer items-center justify-between px-6 py-4 font-medium">
                <span>{group.name}</span>
                <ComponentStatusBadge status={worstOf(worst)} />
              </summary>
              <div className="flex flex-col divide-y divide-[var(--border)] pl-4">
                {items.map((c) => (
                  <ComponentRow key={c.id} component={c} />
                ))}
              </div>
            </details>
          );
        })}
        {ungrouped.length > 0 ? (
          <div className="flex flex-col divide-y divide-[var(--border)]">
            {ungrouped.map((c) => (
              <ComponentRow key={c.id} component={c} />
            ))}
          </div>
        ) : null}
      </section>

      {page.theme.showPastIncidents ? <PastIncidents summary={summary} /> : null}
    </ThemedShell>
  );
}

const SEVERITY = [
  'operational',
  'under_maintenance',
  'degraded_performance',
  'partial_outage',
  'major_outage',
] as const;
function worstOf(statuses: (typeof SEVERITY)[number][]) {
  return statuses.reduce(
    (worst, s) => (SEVERITY.indexOf(s) > SEVERITY.indexOf(worst) ? s : worst),
    'operational' as (typeof SEVERITY)[number],
  );
}

function ComponentRow({ component }: { component: PublicSummary['components'][number] }) {
  return (
    <div className="px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{component.name}</span>
          {component.description ? (
            <p className="text-sm text-[var(--muted)]">{component.description}</p>
          ) : null}
        </div>
        <ComponentStatusBadge status={component.status} />
      </div>
      {component.uptime ? (
        <UptimeBar days={component.uptime.days} uptime={component.uptime.uptime} />
      ) : null}
    </div>
  );
}

export function IncidentCard({
  incident,
  slug,
  timeZone,
}: {
  incident: PublicIncident;
  slug: string;
  timeZone: string;
}) {
  const t = useTranslations('incident');
  const timeline = useIncidentTimeline(incident.updates);
  return (
    <article className="rounded-lg border border-status-partial_outage bg-[var(--surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-6 py-3">
        <Link
          href={`/p/${slug}/incidents/${incident.id}`}
          className="font-semibold hover:underline"
        >
          {incident.title}
        </Link>
        <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
          {t(`impact.${incident.impact}`)}
          <IncidentStatusBadge status={incident.status} />
        </span>
      </header>
      <div className="px-6 py-4">
        <Timeline items={timeline} timeZone={timeZone} />
      </div>
    </article>
  );
}

export function MaintenanceCard({
  maintenance,
  slug,
  timeZone,
}: {
  maintenance: PublicMaintenance;
  slug: string;
  timeZone: string;
}) {
  const t = useTranslations('maintenance');
  const timeline = useMaintenanceTimeline(maintenance.updates);
  return (
    <article className="rounded-lg border border-status-under_maintenance bg-[var(--surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-6 py-3">
        <Link
          href={`/p/${slug}/maintenances/${maintenance.id}`}
          className="font-semibold hover:underline"
        >
          {maintenance.title}
        </Link>
        <MaintenanceStatusBadge status={maintenance.status} />
      </header>
      <div className="flex flex-col gap-3 px-6 py-4">
        <p className="text-sm">
          {t('window')}:{' '}
          <LocalTime value={maintenance.scheduledStart} fallbackTimeZone={timeZone} /> –{' '}
          <LocalTime value={maintenance.scheduledEnd} fallbackTimeZone={timeZone} />
        </p>
        {maintenance.components.length > 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {t('affects')}: {maintenance.components.map((c) => c.component.name).join(', ')}
          </p>
        ) : null}
        <Timeline items={timeline} timeZone={timeZone} />
      </div>
    </article>
  );
}

function PastIncidents({ summary }: { summary: PublicSummary }) {
  const t = useTranslations('home');
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('pastIncidents')}</h2>
      {summary.pastIncidents.length === 0 ? (
        <p className="text-[var(--muted)]">
          {t('noPastIncidents', { days: summary.pastIncidentDays })}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {summary.pastIncidents.map((incident) => (
            <li key={incident.id} className="flex flex-col gap-1 px-6 py-4">
              <Link
                href={`/p/${summary.page.slug}/incidents/${incident.id}`}
                className="font-medium hover:underline"
              >
                {incident.title}
              </Link>
              <p className="text-sm text-[var(--muted)]">
                <LocalTime value={incident.startedAt} fallbackTimeZone={summary.page.timezone} />
                {incident.updates[0]?.body ? ` · ${incident.updates[0].body.slice(0, 160)}` : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
