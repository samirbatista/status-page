'use client';

import {
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  type ComponentStatus,
  type IncidentImpact,
  type IncidentStatus,
} from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Button, Checkbox, Field, Input, Select, Textarea } from '../ui/ui';
import { AffectedComponents, toChanges, type Affected } from './affected-components';

/** Nova atualização de um incidente (status, mensagem e componentes). */
export function IncidentUpdateForm({
  pageId,
  incidentId,
  currentStatus,
  components,
  affectedIds,
}: {
  pageId: string;
  incidentId: string;
  currentStatus: IncidentStatus;
  components: { id: string; name: string; status: ComponentStatus }[];
  affectedIds: string[];
}) {
  const t = useTranslations();
  const { run, pending, error } = useAction();
  const initialAffected = () =>
    Object.fromEntries(
      components.filter((c) => affectedIds.includes(c.id)).map((c) => [c.id, c.status]),
    ) as Affected;
  const [status, setStatus] = useState<IncidentStatus>(currentStatus);
  const [body, setBody] = useState('');
  const [affected, setAffected] = useState<Affected>(initialAffected);
  const [notify, setNotify] = useState(true);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Limpa a mensagem antes de atualizar a página, junto com o sucesso da requisição.
    await run(() =>
      api(`/pages/${pageId}/incidents/${incidentId}/updates`, {
        method: 'POST',
        body: { status, body, notify, components: toChanges(affected) },
      }).then(() => setBody('')),
    );
  }

  return (
    <form onSubmit={onSubmit}>
      {/* Bloqueado durante o envio: o texto seria limpo ao concluir. */}
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <Field label={t('admin.incidents.status')}>
          <Select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as IncidentStatus)}
          >
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`incident.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.incidents.message')}>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={10_000}
          />
        </Field>
        <AffectedComponents components={components} value={affected} onChange={setAffected} />
        {status === 'resolved' ? (
          <p className="text-xs text-[var(--muted)]">{t('admin.incidents.resolveHint')}</p>
        ) : null}
        <Checkbox
          label={t('admin.notify')}
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
        />
        <ApiErrorAlert error={error} />
        <div>
          <Button type="submit" disabled={pending}>
            {t('admin.incidents.postUpdate')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

/** Edição de título/impacto e exclusão (Admin). */
export function IncidentEditForm({
  pageId,
  incidentId,
  title,
  impact,
  canDelete,
}: {
  pageId: string;
  incidentId: string;
  title: string;
  impact: IncidentImpact;
  canDelete: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [value, setValue] = useState(title);
  const [impactValue, setImpact] = useState(impact);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            api(`/pages/${pageId}/incidents/${incidentId}`, {
              method: 'PATCH',
              body: { title: value, impact: impactValue },
            }),
          );
        }}
      >
        <Field label={t('admin.incidents.title')}>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            maxLength={200}
          />
        </Field>
        <Field label={t('admin.incidents.impact')}>
          <Select value={impactValue} onChange={(e) => setImpact(e.target.value as IncidentImpact)}>
            {INCIDENT_IMPACTS.map((i) => (
              <option key={i} value={i}>
                {t(`incident.impact.${i}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('admin.save')}
          </Button>
        </div>
      </form>
      {canDelete ? (
        <div>
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              if (!window.confirm(t('admin.incidents.confirmDelete'))) return;
              const ok = await run(
                () =>
                  api(`/pages/${pageId}/incidents/${incidentId}`, { method: 'DELETE' }).then(
                    () => true,
                  ),
                { refresh: false },
              );
              if (ok) router.push(`/admin/pages/${pageId}/incidents`);
            }}
          >
            {t('admin.delete')}
          </Button>
        </div>
      ) : null}
      <ApiErrorAlert error={error} />
    </div>
  );
}
