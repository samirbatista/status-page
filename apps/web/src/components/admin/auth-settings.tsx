'use client';

import { type AuthSettings, ROLES } from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { type LdapProvider } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import { Alert, Button, Card, Checkbox, EmptyState, Field, Select } from '../ui/ui';

/** Política de MFA e de login local (contas de emergência). */
export function AuthPolicyForm({ settings }: { settings: AuthSettings }) {
  const t = useTranslations('admin.authSettings');
  const tRole = useTranslations('admin.page.role');
  const { run, pending, error } = useAction();
  const [mode, setMode] = useState(settings.mfa.mode);
  const [roles, setRoles] = useState(new Set(settings.mfa.roles));
  const [localLogin, setLocalLogin] = useState(settings.localLogin);
  const [saved, setSaved] = useState(false);

  return (
    <Card title={t('policyHeading')}>
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaved(false);
          const ok = await run(() =>
            api('/auth/settings', {
              method: 'PUT',
              body: { mfa: { mode, roles: mode === 'roles' ? [...roles] : [] }, localLogin },
            }).then(() => true),
          );
          if (ok) setSaved(true);
        }}
      >
        <Field label={t('mfaMode')} hint={t('mfaModeHint')}>
          <Select
            name="mfaMode"
            value={mode}
            onChange={(e) => setMode(e.target.value as AuthSettings['mfa']['mode'])}
          >
            <option value="off">{t('mfaOff')}</option>
            <option value="roles">{t('mfaRoles')}</option>
            <option value="all">{t('mfaAll')}</option>
          </Select>
        </Field>
        {mode === 'roles' ? (
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-sm font-medium">{t('mfaRolesLegend')}</legend>
            {[...ROLES].reverse().map((role) => (
              <Checkbox
                key={role}
                name={`role-${role}`}
                label={tRole(role)}
                checked={roles.has(role)}
                onChange={(e) => {
                  const nextRoles = new Set(roles);
                  if (e.target.checked) nextRoles.add(role);
                  else nextRoles.delete(role);
                  setRoles(nextRoles);
                }}
              />
            ))}
          </fieldset>
        ) : null}
        <Field label={t('localLogin')} hint={t('localLoginHint')}>
          <Select
            name="localLogin"
            value={localLogin}
            onChange={(e) => setLocalLogin(e.target.value as AuthSettings['localLogin'])}
          >
            <option value="all">{t('localAll')}</option>
            <option value="break_glass_only">{t('localBreakGlass')}</option>
          </Select>
        </Field>
        <ApiErrorAlert error={error} />
        {saved ? <Alert tone="info">{t('saved')}</Alert> : null}
        <div>
          <Button type="submit" disabled={pending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function LdapProviderList({ providers }: { providers: LdapProvider[] }) {
  const t = useTranslations('admin.ldap');
  return (
    <Card
      title={t('heading')}
      actions={
        <Link href="/admin/settings/ldap/new" className="text-sm text-brand">
          + {t('add')}
        </Link>
      }
    >
      {providers.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <Link href={`/admin/settings/ldap/${p.id}`} className="font-medium text-brand">
                  {p.name}
                </Link>
                {!p.enabled ? (
                  <span className="ml-2 text-xs text-[var(--muted)]">{t('disabledBadge')}</span>
                ) : null}
                <p className="text-sm text-[var(--muted)]">
                  {t(`kind.${p.kind}`)} · {p.host}:{p.port} · {t(`security.${p.security}`)}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {t('usersCount', { count: p.users })} ·{' '}
                  {t('mappingsCount', { count: p.mappingCount ?? 0 })}
                  {p.lastSyncAt ? (
                    <>
                      {' '}
                      · {t('lastSync')} <LocalTime value={p.lastSyncAt} />
                    </>
                  ) : null}
                  {p.lastSyncError ? (
                    <span className="text-status-major_outage">
                      {' '}
                      · {t('syncError')}: {p.lastSyncError}
                    </span>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
