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
import { fromLocalInput, toLocalInput } from '@/lib/datetime';
import { type IncidentTemplate } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Button, Checkbox, Field, Input, Select, Textarea } from '../ui/ui';
import { AffectedComponents, toChanges, type Affected } from './affected-components';

export function IncidentForm({
  pageId,
  components,
  templates,
}: {
  pageId: string;
  components: { id: string; name: string; status: ComponentStatus }[];
  templates: IncidentTemplate[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<IncidentStatus>('investigating');
  const [impact, setImpact] = useState<IncidentImpact>('minor');
  const [affected, setAffected] = useState<Affected>({});
  const [notify, setNotify] = useState(true);
  const [backfill, setBackfill] = useState(false);
  const [startedAt, setStartedAt] = useState(() => toLocalInput(new Date(Date.now() - 3_600_000)));
  const [resolvedAt, setResolvedAt] = useState(() => toLocalInput(new Date()));

  function applyTemplate(id: string) {
    const template = templates.find((tpl) => tpl.id === id);
    if (!template) return;
    setTitle(template.title);
    setBody(template.body);
    setStatus(template.status);
    setImpact(template.impact);
    const next: Affected = {};
    for (const componentId of template.componentIds) {
      const current = components.find((c) => c.id === componentId);
      if (current) next[componentId] = template.componentStatus ?? current.status;
    }
    setAffected(next);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const created = await run(
      () =>
        api<{ id: string }>(`/pages/${pageId}/incidents`, {
          method: 'POST',
          body: {
            title,
            body,
            status,
            impact,
            notify,
            components: toChanges(affected),
            ...(backfill
              ? {
                  backfill: {
                    startedAt: fromLocalInput(startedAt),
                    resolvedAt: fromLocalInput(resolvedAt),
                  },
                }
              : {}),
          },
        }),
      { refresh: false },
    );
    if (created) router.push(`/admin/pages/${pageId}/incidents/${created.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {templates.length > 0 ? (
        <Field label={t('admin.incidents.template')}>
          <Select defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">{t('admin.incidents.noTemplate')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t('admin.incidents.title')}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('admin.incidents.status')}>
          <Select
            value={backfill ? 'resolved' : status}
            disabled={backfill}
            onChange={(e) => setStatus(e.target.value as IncidentStatus)}
          >
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`incident.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.incidents.impact')}>
          <Select value={impact} onChange={(e) => setImpact(e.target.value as IncidentImpact)}>
            {INCIDENT_IMPACTS.map((i) => (
              <option key={i} value={i}>
                {t(`incident.impact.${i}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t('admin.incidents.message')}>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          maxLength={10_000}
        />
      </Field>
      <AffectedComponents components={components} value={affected} onChange={setAffected} />
      <Checkbox
        label={t('admin.incidents.backfill')}
        checked={backfill}
        onChange={(e) => setBackfill(e.target.checked)}
      />
      {backfill ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.incidents.startedAt')}>
            <Input
              type="datetime-local"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              required
            />
          </Field>
          <Field label={t('admin.incidents.resolvedAt')}>
            <Input
              type="datetime-local"
              value={resolvedAt}
              onChange={(e) => setResolvedAt(e.target.value)}
              required
            />
          </Field>
          <p className="text-xs text-[var(--muted)] sm:col-span-2">
            {t('admin.incidents.backfillHint')}
          </p>
        </div>
      ) : (
        <Checkbox
          label={t('admin.notify')}
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
        />
      )}
      <ApiErrorAlert error={error} />
      <div>
        <Button type="submit" disabled={pending}>
          {t('admin.incidents.create')}
        </Button>
      </div>
    </form>
  );
}
