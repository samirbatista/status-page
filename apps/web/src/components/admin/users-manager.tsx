'use client';

import { useTranslations } from 'next-intl';
import { api } from '@/lib/client-api';
import { type AdminUser } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import { Button, Card, Checkbox, Field, Input } from '../ui/ui';

export function UsersManager({
  users,
  pages,
  currentUserId,
}: {
  users: AdminUser[];
  pages: { id: string; name: string }[];
  currentUserId: string;
}) {
  const t = useTranslations('admin');
  const { run, pending, error } = useAction();
  const pageName = new Map(pages.map((p) => [p.id, p.name]));

  return (
    <div className="flex flex-col gap-6">
      <Card title={t('users.heading')}>
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {users.map((u) => (
            <li key={u.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {u.name}
                    {u.isOwner ? (
                      <span className="ml-2 text-xs text-brand">{t('page.role.owner')}</span>
                    ) : null}
                    {u.isBreakGlass ? (
                      <span className="ml-2 text-xs text-brand">{t('users.breakGlass')}</span>
                    ) : null}
                    {u.disabledAt ? (
                      <span className="ml-2 text-xs text-status-major_outage">
                        {t('users.disabled')}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-[var(--muted)]">{u.email}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {u.identities
                      .map((i) =>
                        i.provider === 'ldap'
                          ? `${i.ldapProvider?.name ?? 'LDAP'}${i.username ? ` (${i.username})` : ''}${
                              i.disabledAt ? ` — ${t('users.directoryDisabled')}` : ''
                            }`
                          : t('profile.provider.local'),
                      )
                      .join(' · ')}
                    {' · '}
                    {u.mfa.totp || u.mfa.webauthn > 0 ? t('users.mfaOn') : t('users.mfaOff')}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {t('users.lastLogin')}:{' '}
                    {u.lastLoginAt ? <LocalTime value={u.lastLoginAt} /> : '—'}
                  </p>
                  {u.pageRoles.length > 0 ? (
                    <p className="text-xs text-[var(--muted)]">
                      {u.pageRoles
                        .map(
                          (r) =>
                            `${pageName.get(r.pageId) ?? r.pageId}: ${t(`page.role.${r.role}`)}${
                              r.manual ? '' : ` (${t('users.viaGroup')})`
                            }`,
                        )
                        .join(' · ')}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {u.isOwner && u.identities.some((i) => i.provider === 'local') ? (
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          api(`/users/${u.id}`, {
                            method: 'PATCH',
                            body: { breakGlass: !u.isBreakGlass },
                          }),
                        )
                      }
                    >
                      {u.isBreakGlass ? t('users.unsetBreakGlass') : t('users.setBreakGlass')}
                    </Button>
                  ) : null}
                  {u.id !== currentUserId ? (
                    <>
                      <Button
                        variant="secondary"
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            api(`/users/${u.id}`, {
                              method: 'PATCH',
                              body: { isOwner: !u.isOwner },
                            }),
                          )
                        }
                      >
                        {u.isOwner ? t('users.removeOwner') : t('users.makeOwner')}
                      </Button>
                      {u.mfa.totp || u.mfa.webauthn > 0 ? (
                        <Button
                          variant="secondary"
                          disabled={pending}
                          onClick={() => {
                            if (window.confirm(t('users.resetMfaConfirm', { name: u.name })))
                              void run(() => api(`/users/${u.id}/mfa/reset`, { method: 'POST' }));
                          }}
                        >
                          {t('users.resetMfa')}
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        disabled={pending}
                        onClick={() => {
                          const password = window.prompt(t('users.newPasswordPrompt'));
                          if (password)
                            void run(() =>
                              api(`/users/${u.id}/password`, {
                                method: 'POST',
                                body: { password },
                              }),
                            );
                        }}
                      >
                        {t('users.resetPassword')}
                      </Button>
                      <Button
                        variant={u.disabledAt ? 'secondary' : 'danger'}
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            api(`/users/${u.id}`, {
                              method: 'PATCH',
                              body: { disabled: !u.disabledAt },
                            }),
                          )
                        }
                      >
                        {u.disabledAt ? t('users.enable') : t('users.disable')}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <ApiErrorAlert error={error} />
      </Card>
      <Card title={t('users.new')}>
        <NewUserForm />
      </Card>
    </div>
  );
}

function NewUserForm() {
  const t = useTranslations('admin.users');
  const { run, pending, error } = useAction();
  return (
    <form
      method="post"
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const ok = await run(() =>
          api('/users', {
            method: 'POST',
            body: {
              name: form.get('name'),
              email: form.get('email'),
              password: form.get('password'),
              isOwner: form.get('isOwner') === 'on',
            },
          }).then(() => true),
        );
        if (ok) formElement.reset();
      }}
    >
      <Field label={t('name')}>
        <Input name="name" required maxLength={120} />
      </Field>
      <Field label={t('email')}>
        <Input name="email" type="email" required />
      </Field>
      <Field label={t('initialPassword')} hint={t('passwordHint')}>
        <Input
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
      </Field>
      <div className="flex items-end">
        <Checkbox name="isOwner" label={t('owner')} />
      </div>
      <div className="sm:col-span-2">
        <ApiErrorAlert error={error} />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {t('create')}
        </Button>
      </div>
    </form>
  );
}
