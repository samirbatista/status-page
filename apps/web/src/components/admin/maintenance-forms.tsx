'use client';

import { type MaintenanceStatus } from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { fromLocalInput, toLocalInput } from '@/lib/datetime';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Button, Checkbox, Field, Input, Textarea } from '../ui/ui';

function ComponentChecklist({
  components,
  value,
  onChange,
  disabled,
}: {
  components: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('admin.maintenances');
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">{t('components')}</legend>
      {components.map((c) => (
        <Checkbox
          key={c.id}
          label={c.name}
          checked={value.includes(c.id)}
          onChange={(e) =>
            onChange(e.target.checked ? [...value, c.id] : value.filter((id) => id !== c.id))
          }
        />
      ))}
    </fieldset>
  );
}

export function MaintenanceForm({
  pageId,
  components,
}: {
  pageId: string;
  components: { id: string; name: string }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [autoStart, setAutoStart] = useState(true);
  const [autoComplete, setAutoComplete] = useState(true);
  const [notify, setNotify] = useState(true);
  const [defaults] = useState(() => {
    const start = new Date(Date.now() + 24 * 3_600_000);
    start.setMinutes(0, 0, 0);
    return {
      start: toLocalInput(start),
      end: toLocalInput(new Date(start.getTime() + 2 * 3_600_000)),
    };
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = await run(
      () =>
        api<{ id: string }>(`/pages/${pageId}/maintenances`, {
          method: 'POST',
          body: {
            title: form.get('title'),
            body: form.get('body'),
            scheduledStart: fromLocalInput(String(form.get('start'))),
            scheduledEnd: fromLocalInput(String(form.get('end'))),
            autoStart,
            autoComplete,
            notify,
            componentIds,
          },
        }),
      { refresh: false },
    );
    if (created) router.push(`/admin/pages/${pageId}/maintenances/${created.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={t('admin.maintenances.title')}>
        <Input name="title" required maxLength={200} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('admin.maintenances.start')}>
          <Input name="start" type="datetime-local" defaultValue={defaults.start} required />
        </Field>
        <Field label={t('admin.maintenances.end')}>
          <Input name="end" type="datetime-local" defaultValue={defaults.end} required />
        </Field>
      </div>
      <Field label={t('admin.maintenances.message')}>
        <Textarea name="body" required maxLength={10_000} />
      </Field>
      <ComponentChecklist components={components} value={componentIds} onChange={setComponentIds} />
      <Checkbox
        label={t('admin.maintenances.autoStart')}
        checked={autoStart}
        onChange={(e) => setAutoStart(e.target.checked)}
      />
      <Checkbox
        label={t('admin.maintenances.autoComplete')}
        checked={autoComplete}
        onChange={(e) => setAutoComplete(e.target.checked)}
      />
      <Checkbox
        label={t('admin.notify')}
        checked={notify}
        onChange={(e) => setNotify(e.target.checked)}
      />
      <ApiErrorAlert error={error} />
      <div>
        <Button type="submit" disabled={pending}>
          {t('admin.maintenances.create')}
        </Button>
      </div>
    </form>
  );
}

export function MaintenanceUpdateForm({
  pageId,
  maintenanceId,
  status,
  canDelete,
}: {
  pageId: string;
  maintenanceId: string;
  status: MaintenanceStatus;
  canDelete: boolean;
}) {
  const t = useTranslations('admin');
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [body, setBody] = useState('');

  const post = (transition?: 'in_progress' | 'completed') =>
    run(() =>
      api(`/pages/${pageId}/maintenances/${maintenanceId}/updates`, {
        method: 'POST',
        body: { body, ...(transition ? { status: transition } : {}) },
      }).then(() => setBody('')),
    );

  return (
    <div className="flex flex-col gap-4">
      {status !== 'completed' ? (
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <Field label={t('maintenances.message')} hint={t('maintenances.messageHint')}>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={10_000} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || !body} variant="secondary" onClick={() => post()}>
              {t('maintenances.postUpdate')}
            </Button>
            {status === 'scheduled' ? (
              <Button disabled={pending} onClick={() => post('in_progress')}>
                {t('maintenances.startNow')}
              </Button>
            ) : null}
            <Button disabled={pending} onClick={() => post('completed')}>
              {t('maintenances.completeNow')}
            </Button>
          </div>
        </fieldset>
      ) : null}
      {canDelete && status !== 'in_progress' ? (
        <div>
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              if (!window.confirm(t('maintenances.confirmDelete'))) return;
              const ok = await run(
                () =>
                  api(`/pages/${pageId}/maintenances/${maintenanceId}`, { method: 'DELETE' }).then(
                    () => true,
                  ),
                { refresh: false },
              );
              if (ok) router.push(`/admin/pages/${pageId}/maintenances`);
            }}
          >
            {t('delete')}
          </Button>
        </div>
      ) : null}
      <ApiErrorAlert error={error} />
    </div>
  );
}
