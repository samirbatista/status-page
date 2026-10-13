'use client';

import { useTranslations } from 'next-intl';
import { api } from '@/lib/client-api';
import { type SessionInfo } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import { Alert, Button, Card, Field, Input } from '../ui/ui';

export function ChangePasswordForm() {
  const t = useTranslations('admin.profile');
  const { run, pending, error } = useAction();
  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        if (form.get('newPassword') !== form.get('confirm')) {
          window.alert(t('mismatch'));
          return;
        }
        const ok = await run(() =>
          api('/auth/password', {
            method: 'POST',
            body: {
              currentPassword: form.get('currentPassword'),
              newPassword: form.get('newPassword'),
            },
          }).then(() => true),
        );
        if (ok) {
          formElement.reset();
          window.alert(t('changed'));
        }
      }}
    >
      <Field label={t('current')}>
        <Input name="currentPassword" type="password" required autoComplete="current-password" />
      </Field>
      <Field label={t('new')} hint={t('hint')}>
        <Input
          name="newPassword"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
      </Field>
      <Field label={t('confirm')}>
        <Input name="confirm" type="password" required minLength={12} autoComplete="new-password" />
      </Field>
      <ApiErrorAlert error={error} />
      <div>
        <Button type="submit" disabled={pending}>
          {t('change')}
        </Button>
      </div>
    </form>
  );
}

export function SessionsList({ sessions }: { sessions: SessionInfo[] }) {
  const t = useTranslations('admin.profile');
  const { run, pending, error } = useAction();
  return (
    <Card title={t('sessions')}>
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="text-sm">
              <p className="font-medium">
                {s.ip ?? '—'}
                {s.current ? (
                  <span className="ml-2 text-xs text-brand">{t('thisSession')}</span>
                ) : null}
              </p>
              <p className="max-w-md truncate text-xs text-[var(--muted)]">{s.userAgent}</p>
              <p className="text-xs text-[var(--muted)]">
                {t('lastActive')}: <LocalTime value={s.lastActiveAt} />
              </p>
            </div>
            {!s.current ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => api(`/auth/sessions/${s.id}`, { method: 'DELETE' }))}
              >
                {t('revoke')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <ApiErrorAlert error={error} />
    </Card>
  );
}

export function NoLocalPassword() {
  const t = useTranslations('admin.profile');
  return <Alert tone="info">{t('noLocalPassword')}</Alert>;
}
