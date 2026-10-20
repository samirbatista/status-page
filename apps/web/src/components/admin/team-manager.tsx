'use client';

import { type Role } from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import { type TeamMember } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Button, Card, EmptyState, Field, Input, Select } from '../ui/ui';

const PAGE_ROLES = ['viewer', 'operator', 'admin'] as const;

export function TeamManager({ pageId, team }: { pageId: string; team: TeamMember[] }) {
  const t = useTranslations('admin');
  const { run, pending, error } = useAction();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; email: string }[]>([]);
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('operator');

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const found = await run(
      () =>
        api<{ id: string; name: string; email: string }[]>(
          `/users/directory?q=${encodeURIComponent(query)}`,
        ),
      { refresh: false },
    );
    if (found) setResults(found.filter((u) => !team.some((m) => m.id === u.id)));
  }

  return (
    <div className="flex flex-col gap-6">
      <Card title={t('team.heading')}>
        {team.length === 0 ? (
          <EmptyState>{t('team.empty')}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {team.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div>
                  <p className="font-medium">{member.name}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {member.email}
                    {member.disabledAt ? ` · ${t('users.disabled')}` : null}
                    {!member.manual ? ` · ${t('users.viaGroup')}` : null}
                    {' · '}
                    {member.mfa ? t('users.mfaOn') : t('users.mfaOff')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    aria-label={t('team.role')}
                    className="w-auto"
                    value={member.role}
                    disabled={pending}
                    onChange={(e) =>
                      run(() =>
                        api(`/pages/${pageId}/team/${member.id}`, {
                          method: 'PUT',
                          body: { role: e.target.value },
                        }),
                      )
                    }
                  >
                    {PAGE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`page.role.${r}`)}
                      </option>
                    ))}
                  </Select>
                  {member.mfa && !member.isOwner ? (
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(t('users.resetMfaConfirm', { name: member.name })))
                          void run(() => api(`/users/${member.id}/mfa/reset`, { method: 'POST' }));
                      }}
                    >
                      {t('users.resetMfa')}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(() => api(`/pages/${pageId}/team/${member.id}`, { method: 'DELETE' }))
                    }
                  >
                    {t('team.remove')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('team.add')}>
        <form onSubmit={search} className="flex flex-wrap items-end gap-2">
          <Field label={t('team.search')} className="min-w-60 flex-1">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          <Field label={t('team.role')}>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as Exclude<Role, 'owner'>)}
            >
              {PAGE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`page.role.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('team.searchButton')}
          </Button>
        </form>
        {results.length > 0 ? (
          <ul className="mt-4 flex flex-col divide-y divide-[var(--border)]">
            {results.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {u.name} <span className="text-sm text-[var(--muted)]">{u.email}</span>
                </span>
                <Button
                  disabled={pending}
                  onClick={async () => {
                    await run(() =>
                      api(`/pages/${pageId}/team/${u.id}`, { method: 'PUT', body: { role } }),
                    );
                    setResults((r) => r.filter((x) => x.id !== u.id));
                  }}
                >
                  {t('team.addButton')}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-xs text-[var(--muted)]">{t('team.hint')}</p>
      </Card>
      <ApiErrorAlert error={error} />
    </div>
  );
}
