'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import { type SuggestedAlert } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import { ComponentStatusBadge } from '../status-badge';
import { Button, Card, Checkbox } from '../ui/ui';

/** Sugestões do modo "sugestão" aguardando o operador (visão geral da página). */
export function SuggestedAlerts({
  pageId,
  alerts,
  canAct,
}: {
  pageId: string;
  alerts: SuggestedAlert[];
  canAct: boolean;
}) {
  const t = useTranslations('admin.alerts');
  if (alerts.length === 0) return null;
  return (
    <Card title={t('heading', { count: alerts.length })}>
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {alerts.map((a) => (
          <AlertRow key={a.id} pageId={pageId} alert={a} canAct={canAct} />
        ))}
      </ul>
    </Card>
  );
}

function AlertRow({
  pageId,
  alert,
  canAct,
}: {
  pageId: string;
  alert: SuggestedAlert;
  canAct: boolean;
}) {
  const t = useTranslations('admin.alerts');
  const { run, pending, error } = useAction();
  const [openIncident, setOpenIncident] = useState(Boolean(alert.templateId));

  return (
    <li className="flex flex-col gap-2 py-3" data-testid="suggested-alert">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {alert.kind === 'failure'
              ? t('failure', { component: alert.component.name })
              : t('recovery', { component: alert.component.name })}
          </p>
          <p className="text-sm text-[var(--muted)]">
            {t(`source.${alert.source}`)}: {alert.title}
            {alert.detail ? ` — ${alert.detail}` : null}
          </p>
          <p className="text-xs text-[var(--muted)]">
            <LocalTime value={alert.createdAt} />
            {alert.occurrences > 1 ? ` · ${t('occurrences', { count: alert.occurrences })}` : null}
          </p>
        </div>
        <span className="flex items-center gap-2 text-sm">
          <ComponentStatusBadge status={alert.component.status} /> →{' '}
          <ComponentStatusBadge status={alert.suggestedStatus} />
        </span>
      </div>
      {canAct ? (
        <div className="flex flex-wrap items-center gap-3">
          {alert.kind === 'failure' && alert.templateId ? (
            <Checkbox
              label={t('openIncident')}
              checked={openIncident}
              onChange={(e) => setOpenIncident(e.target.checked)}
            />
          ) : null}
          <Button
            disabled={pending}
            onClick={() =>
              run(() =>
                api(`/pages/${pageId}/alerts/${alert.id}/accept`, {
                  method: 'POST',
                  body: { openIncident },
                }),
              )
            }
          >
            {alert.kind === 'failure' ? t('apply') : t('restore')}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(() => api(`/pages/${pageId}/alerts/${alert.id}/dismiss`, { method: 'POST' }))
            }
          >
            {t('dismiss')}
          </Button>
        </div>
      ) : null}
      <ApiErrorAlert error={error} />
    </li>
  );
}
