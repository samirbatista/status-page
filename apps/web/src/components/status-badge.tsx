import {
  type ComponentStatus,
  type IncidentStatus,
  type MaintenanceStatus,
} from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { cx } from './ui/ui';

// Classes completas (e não interpoladas) para o Tailwind detectá-las no build.
export const STATUS_TEXT: Record<ComponentStatus, string> = {
  operational: 'text-status-operational',
  under_maintenance: 'text-status-under_maintenance',
  degraded_performance: 'text-status-degraded_performance',
  partial_outage: 'text-status-partial_outage',
  major_outage: 'text-status-major_outage',
};

export const STATUS_BG: Record<ComponentStatus, string> = {
  operational: 'bg-status-operational',
  under_maintenance: 'bg-status-under_maintenance',
  degraded_performance: 'bg-status-degraded_performance',
  partial_outage: 'bg-status-partial_outage',
  major_outage: 'bg-status-major_outage',
};

export function ComponentStatusBadge({ status }: { status: ComponentStatus }) {
  const t = useTranslations('status');
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 text-sm font-medium', STATUS_TEXT[status])}
    >
      <span aria-hidden className={cx('size-2.5 rounded-full', STATUS_BG[status])} />
      {t(status)}
    </span>
  );
}

const INCIDENT_COLOR: Record<IncidentStatus, string> = {
  investigating: 'border-status-major_outage text-status-major_outage',
  identified: 'border-status-partial_outage text-status-partial_outage',
  monitoring: 'border-status-degraded_performance text-status-degraded_performance',
  resolved: 'border-status-operational text-status-operational',
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const t = useTranslations('incident');
  return (
    <span
      className={cx('rounded-full border px-2 py-0.5 text-xs font-medium', INCIDENT_COLOR[status])}
    >
      {t(status)}
    </span>
  );
}

export function MaintenanceStatusBadge({ status }: { status: MaintenanceStatus }) {
  const t = useTranslations('maintenance.status');
  return (
    <span className="rounded-full border border-status-under_maintenance px-2 py-0.5 text-xs font-medium text-status-under_maintenance">
      {t(status)}
    </span>
  );
}
