'use client';

import {
  COMPONENT_STATUSES,
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  type ComponentStatus,
  type IncidentImpact,
  type IncidentStatus,
} from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import { type IncidentTemplate } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Button, Card, Checkbox, EmptyState, Field, Input, Select, Textarea } from '../ui/ui';

export function TemplatesManager({
  pageId,
  templates,
  components,
  canEdit,
}: {
  pageId: string;
  templates: IncidentTemplate[];
  components: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const t = useTranslations('admin.templates');
  const [editing, setEditing] = useState<IncidentTemplate | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('heading')}
        actions={
          canEdit ? (
            <Button variant="secondary" onClick={() => setEditing('new')}>
              + {t('new')}
            </Button>
          ) : null
        }
      >
        {templates.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">{tpl.name}</p>
                  <p className="text-sm text-[var(--muted)]">{tpl.title}</p>
                </div>
                {canEdit ? (
                  <Button variant="secondary" onClick={() => setEditing(tpl)}>
                    {t('edit')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing ? (
        <Card title={editing === 'new' ? t('new') : editing.name}>
          <TemplateForm
            key={editing === 'new' ? 'new' : editing.id}
            pageId={pageId}
            template={editing === 'new' ? null : editing}
            components={components}
            onDone={() => setEditing(null)}
          />
        </Card>
      ) : null}
    </div>
  );
}

function TemplateForm({
  pageId,
  template,
  components,
  onDone,
}: {
  pageId: string;
  template: IncidentTemplate | null;
  components: { id: string; name: string }[];
  onDone: () => void;
}) {
  const t = useTranslations();
  const { run, pending, error } = useAction();
  const [componentIds, setComponentIds] = useState<string[]>(template?.componentIds ?? []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const componentStatus = String(form.get('componentStatus'));
    const body = {
      name: form.get('name'),
      title: form.get('title'),
      body: form.get('body'),
      status: form.get('status') as IncidentStatus,
      impact: form.get('impact') as IncidentImpact,
      componentIds,
      componentStatus: (componentStatus || null) as ComponentStatus | null,
    };
    const ok = await run(() =>
      (template
        ? api(`/pages/${pageId}/templates/${template.id}`, { method: 'PUT', body })
        : api(`/pages/${pageId}/templates`, { method: 'POST', body })
      ).then(() => true),
    );
    if (ok) onDone();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={t('admin.templates.name')}>
        <Input name="name" defaultValue={template?.name} required maxLength={120} />
      </Field>
      <Field label={t('admin.incidents.title')}>
        <Input name="title" defaultValue={template?.title} required maxLength={200} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('admin.incidents.status')}>
          <Select name="status" defaultValue={template?.status ?? 'investigating'}>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`incident.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.incidents.impact')}>
          <Select name="impact" defaultValue={template?.impact ?? 'minor'}>
            {INCIDENT_IMPACTS.map((i) => (
              <option key={i} value={i}>
                {t(`incident.impact.${i}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.templates.componentStatus')}>
          <Select name="componentStatus" defaultValue={template?.componentStatus ?? ''}>
            <option value="">{t('admin.templates.keepStatus')}</option>
            {COMPONENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t('admin.incidents.message')}>
        <Textarea name="body" defaultValue={template?.body} required maxLength={10_000} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('admin.incidents.affected')}</legend>
        {components.map((c) => (
          <Checkbox
            key={c.id}
            label={c.name}
            checked={componentIds.includes(c.id)}
            onChange={(e) =>
              setComponentIds(
                e.target.checked
                  ? [...componentIds, c.id]
                  : componentIds.filter((id) => id !== c.id),
              )
            }
          />
        ))}
      </fieldset>
      <ApiErrorAlert error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {t('admin.save')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('admin.cancel')}
        </Button>
        {template ? (
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              if (!window.confirm(t('admin.templates.confirmDelete'))) return;
              const ok = await run(() =>
                api(`/pages/${pageId}/templates/${template.id}`, { method: 'DELETE' }).then(
                  () => true,
                ),
              );
              if (ok) onDone();
            }}
          >
            {t('admin.delete')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
