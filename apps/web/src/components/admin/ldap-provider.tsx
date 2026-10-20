'use client';

import {
  LDAP_DEFAULTS,
  LDAP_KINDS,
  LDAP_SECURITY,
  type LdapKind,
  type LdapSecurity,
  type Role,
  ROLES,
} from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { type LdapProvider, type LdapProviderDetail } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Textarea } from '../ui/ui';

const FORM_FIELDS = [
  'name',
  'kind',
  'enabled',
  'host',
  'port',
  'security',
  'verifyCertificate',
  'caCertificate',
  'bindDn',
  'baseDn',
  'userFilter',
  'usernameAttribute',
  'emailAttribute',
  'nameAttribute',
  'uniqueIdAttribute',
  'nestedGroups',
  'groupBaseDn',
  'groupFilter',
  'manualRolesWin',
  'linkByEmail',
  'timeoutMs',
] as const;

type FormState = Pick<LdapProvider, (typeof FORM_FIELDS)[number]> & { bindPassword: string };

function initialState(provider?: LdapProvider): FormState {
  if (provider) {
    const picked = Object.fromEntries(FORM_FIELDS.map((key) => [key, provider[key]]));
    return { ...(picked as Omit<FormState, 'bindPassword'>), bindPassword: '' };
  }
  return {
    name: '',
    kind: 'active_directory',
    enabled: true,
    host: '',
    verifyCertificate: true,
    caCertificate: null,
    bindDn: '',
    bindPassword: '',
    baseDn: '',
    groupBaseDn: null,
    manualRolesWin: true,
    linkByEmail: false,
    timeoutMs: 5000,
    ...LDAP_DEFAULTS.active_directory,
  };
}

/** Corpo enviado à API (campos opcionais vazios viram nulos). */
function payload(state: FormState) {
  return {
    ...state,
    caCertificate: state.caCertificate || null,
    groupBaseDn: state.groupBaseDn || null,
    groupFilter: state.groupFilter || null,
  };
}

export function LdapProviderForm({ provider }: { provider?: LdapProvider }) {
  const t = useTranslations('admin.ldap');
  const router = useRouter();
  const { run, pending, error } = useAction();
  const test = useAction();
  const [state, setState] = useState<FormState>(() => initialState(provider));
  const [testResult, setTestResult] = useState<
    { ok: true; durationMs: number } | { ok: false; error: string } | null
  >(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSaved(false);
    setState((s) => ({ ...s, [key]: value }));
  };

  /** Ao trocar o tipo num provedor novo, aplica os valores padrão daquele diretório. */
  function changeKind(kind: LdapKind) {
    if (provider) return set('kind', kind);
    setState((s) => ({ ...s, kind, ...LDAP_DEFAULTS[kind] }));
  }

  function changeSecurity(security: LdapSecurity) {
    setState((s) => ({
      ...s,
      security,
      port: s.port === 389 || s.port === 636 ? (security === 'ldaps' ? 636 : 389) : s.port,
    }));
  }

  const text = (key: keyof FormState) => ({
    name: key,
    value: (state[key] as string | null) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key, e.target.value as never),
  });

  return (
    <form
      method="post"
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await run(
          () =>
            provider
              ? api<LdapProvider>(`/ldap/providers/${provider.id}`, {
                  method: 'PATCH',
                  body: payload(state),
                })
              : api<LdapProvider>('/ldap/providers', { method: 'POST', body: payload(state) }),
          { refresh: Boolean(provider) },
        );
        if (!result) return;
        if (provider) {
          set('bindPassword', '');
          setSaved(true);
        } else router.replace(`/admin/settings/ldap/${result.id}`);
      }}
    >
      <Card title={t('connection')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('name')}>
            <Input {...text('name')} required maxLength={120} />
          </Field>
          <Field label={t('kindLabel')}>
            <Select
              name="kind"
              value={state.kind}
              onChange={(e) => changeKind(e.target.value as LdapKind)}
            >
              {LDAP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('host')} hint={t('hostHint')}>
            <Input {...text('host')} required placeholder="dc01.empresa.local" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('securityLabel')}>
              <Select
                name="security"
                value={state.security}
                onChange={(e) => changeSecurity(e.target.value as LdapSecurity)}
              >
                {LDAP_SECURITY.map((s) => (
                  <option key={s} value={s}>
                    {t(`security.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('port')}>
              <Input
                name="port"
                type="number"
                min={1}
                max={65535}
                required
                value={state.port}
                onChange={(e) => set('port', Number(e.target.value))}
              />
            </Field>
          </div>
          {state.security === 'none' ? (
            <div className="sm:col-span-2">
              <Alert>{t('noTlsWarning')}</Alert>
            </div>
          ) : (
            <>
              <div className="flex items-end">
                <Checkbox
                  name="verifyCertificate"
                  label={t('verifyCertificate')}
                  checked={state.verifyCertificate}
                  onChange={(e) => set('verifyCertificate', e.target.checked)}
                />
              </div>
              <Field label={t('caCertificate')} hint={t('caHint')} className="sm:col-span-2">
                <Textarea
                  {...text('caCertificate')}
                  className="min-h-20 font-mono text-xs"
                  placeholder="-----BEGIN CERTIFICATE-----"
                />
              </Field>
            </>
          )}
          <Field label={t('bindDn')} hint={t('bindDnHint')}>
            <Input {...text('bindDn')} required />
          </Field>
          <Field label={t('bindPassword')} hint={provider ? t('bindPasswordKeep') : undefined}>
            <Input
              {...text('bindPassword')}
              type="password"
              autoComplete="new-password"
              required={!provider}
            />
          </Field>
          <Field label={t('baseDn')} hint={t('baseDnHint')} className="sm:col-span-2">
            <Input {...text('baseDn')} required placeholder="DC=empresa,DC=local" />
          </Field>
          <Field label={t('timeout')}>
            <Input
              name="timeoutMs"
              type="number"
              min={1000}
              max={60000}
              step={500}
              value={state.timeoutMs}
              onChange={(e) => set('timeoutMs', Number(e.target.value))}
            />
          </Field>
          <div className="flex items-end">
            <Checkbox
              name="enabled"
              label={t('enabled')}
              checked={state.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
          </div>
        </div>
      </Card>

      <Card title={t('users')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('userFilter')} hint={t('userFilterHint')} className="sm:col-span-2">
            <Input {...text('userFilter')} required className="font-mono text-xs" />
          </Field>
          <Field label={t('usernameAttribute')}>
            <Input {...text('usernameAttribute')} required />
          </Field>
          <Field label={t('uniqueIdAttribute')} hint={t('uniqueIdHint')}>
            <Input {...text('uniqueIdAttribute')} required />
          </Field>
          <Field label={t('nameAttribute')}>
            <Input {...text('nameAttribute')} required />
          </Field>
          <Field label={t('emailAttribute')}>
            <Input {...text('emailAttribute')} required />
          </Field>
        </div>
      </Card>

      <Card title={t('groups')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {state.kind === 'active_directory' ? (
            <div className="sm:col-span-2">
              <Checkbox
                name="nestedGroups"
                label={t('nestedGroups')}
                checked={state.nestedGroups}
                onChange={(e) => set('nestedGroups', e.target.checked)}
              />
            </div>
          ) : (
            <>
              <Field label={t('groupBaseDn')} hint={t('groupBaseDnHint')}>
                <Input {...text('groupBaseDn')} />
              </Field>
              <Field label={t('groupFilter')} hint={t('groupFilterHint')} className="sm:col-span-2">
                <Input {...text('groupFilter')} className="font-mono text-xs" />
              </Field>
            </>
          )}
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Checkbox
              name="manualRolesWin"
              label={t('manualRolesWin')}
              checked={state.manualRolesWin}
              onChange={(e) => set('manualRolesWin', e.target.checked)}
            />
            <Checkbox
              name="linkByEmail"
              label={t('linkByEmail')}
              checked={state.linkByEmail}
              onChange={(e) => set('linkByEmail', e.target.checked)}
            />
            {state.linkByEmail ? <Alert>{t('linkByEmailWarning')}</Alert> : null}
          </div>
        </div>
      </Card>

      <ApiErrorAlert error={error ?? test.error} />
      {testResult ? (
        testResult.ok ? (
          <Alert tone="info">{t('testOk', { ms: testResult.durationMs })}</Alert>
        ) : (
          <Alert>
            {t('testFailed')}: {t(`ldapError.${testResult.error}` as 'ldapError.timeout')}
          </Alert>
        )
      ) : null}
      {saved ? <Alert tone="info">{t('saved')}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {provider ? t('save') : t('create')}
        </Button>
        <Button
          variant="secondary"
          disabled={test.pending}
          onClick={async () => {
            setTestResult(null);
            const result = await test.run(
              () =>
                api<typeof testResult>('/ldap/providers/test-connection', {
                  method: 'POST',
                  body: { ...payload(state), id: provider?.id },
                }),
              { refresh: false },
            );
            if (result) setTestResult(result);
          }}
        >
          {test.pending ? t('testing') : t('testConnection')}
        </Button>
      </div>
    </form>
  );
}

interface LoginTestResult {
  status: string;
  error?: string;
  user?: {
    dn: string;
    username: string;
    email: string | null;
    name: string | null;
    uniqueId: string;
    groups: string[];
    disabled: boolean;
  };
  roles?: { owner: boolean; pages: { pageId: string; pageName: string; role: Role }[] };
}

export function LdapLoginTest({ providerId }: { providerId: string }) {
  const t = useTranslations('admin.ldap');
  const tRole = useTranslations('admin.page.role');
  const { run, pending, error } = useAction();
  const [result, setResult] = useState<LoginTestResult | null>(null);
  return (
    <Card title={t('loginTest')}>
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setResult(null);
          const res = await run(
            () =>
              api<LoginTestResult>(`/ldap/providers/${providerId}/test-login`, {
                method: 'POST',
                body: { username: form.get('username'), password: form.get('password') },
              }),
            { refresh: false },
          );
          if (res) setResult(res);
        }}
      >
        <p className="text-sm text-[var(--muted)]">{t('loginTestHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('testUsername')}>
            <Input name="username" required autoComplete="off" />
          </Field>
          <Field label={t('testPassword')}>
            <Input name="password" type="password" required autoComplete="new-password" />
          </Field>
        </div>
        <ApiErrorAlert error={error} />
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? t('testing') : t('runLoginTest')}
          </Button>
        </div>
      </form>
      {result ? (
        <div className="mt-4 flex flex-col gap-2 text-sm" data-testid="ldap-login-result">
          <p className="font-medium">
            {t(`loginStatus.${result.status}` as 'loginStatus.ok')}
            {result.error ? ` (${t(`ldapError.${result.error}` as 'ldapError.timeout')})` : null}
          </p>
          {result.user ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt className="text-[var(--muted)]">DN</dt>
              <dd className="break-all font-mono text-xs">{result.user.dn}</dd>
              <dt className="text-[var(--muted)]">{t('name')}</dt>
              <dd>{result.user.name ?? '—'}</dd>
              <dt className="text-[var(--muted)]">{t('emailAttribute')}</dt>
              <dd>{result.user.email ?? '—'}</dd>
              <dt className="text-[var(--muted)]">{t('groups')}</dt>
              <dd className="whitespace-pre-line break-all font-mono text-xs">
                {result.user.groups.length ? result.user.groups.join('\n') : '—'}
              </dd>
              <dt className="text-[var(--muted)]">{t('resultingRoles')}</dt>
              <dd>
                {[
                  ...(result.roles?.owner ? [tRole('owner')] : []),
                  ...(result.roles?.pages ?? []).map((p) => `${p.pageName}: ${tRole(p.role)}`),
                ].join(' · ') || t('noRoles')}
              </dd>
            </dl>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function LdapMappings({
  provider,
  pages,
}: {
  provider: LdapProviderDetail;
  pages: { id: string; name: string }[];
}) {
  const t = useTranslations('admin.ldap');
  const tRole = useTranslations('admin.page.role');
  const { run, pending, error } = useAction();
  const [pageId, setPageId] = useState<string>(pages[0]?.id ?? '');
  const [role, setRole] = useState<Role>('viewer');
  const isOwnerTarget = pageId === '';

  return (
    <Card title={t('mappings')}>
      <p className="mb-3 text-sm text-[var(--muted)]">{t('mappingsHint')}</p>
      {provider.mappings.length > 0 ? (
        <ul className="mb-4 flex flex-col divide-y divide-[var(--border)]">
          {provider.mappings.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="text-sm">
                <p className="break-all font-mono text-xs">{m.groupDn}</p>
                <p className="text-[var(--muted)]">
                  {m.page
                    ? `${m.page.name}: ${tRole(m.role)}`
                    : `${t('global')}: ${tRole('owner')}`}
                </p>
              </div>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    api(`/ldap/providers/${provider.id}/mappings/${m.id}`, { method: 'DELETE' }),
                  )
                }
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        method="post"
        className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const groupDn = new FormData(formElement).get('groupDn');
          const ok = await run(() =>
            api(`/ldap/providers/${provider.id}/mappings`, {
              method: 'POST',
              body: {
                groupDn,
                pageId: isOwnerTarget ? null : pageId,
                role: isOwnerTarget ? 'owner' : role,
              },
            }).then(() => true),
          );
          if (ok) formElement.reset();
        }}
      >
        <Field label={t('groupDn')}>
          <Input
            name="groupDn"
            required
            className="font-mono text-xs"
            placeholder="CN=NOC,OU=Grupos,DC=empresa,DC=local"
          />
        </Field>
        <Field label={t('target')}>
          <Select name="pageId" value={pageId} onChange={(e) => setPageId(e.target.value)}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="">{t('globalOwner')}</option>
          </Select>
        </Field>
        <Field label={t('role')}>
          <Select
            name="role"
            value={isOwnerTarget ? 'owner' : role}
            disabled={isOwnerTarget}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {(isOwnerTarget ? (['owner'] as const) : ROLES.filter((r) => r !== 'owner')).map(
              (r) => (
                <option key={r} value={r}>
                  {tRole(r)}
                </option>
              ),
            )}
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {t('addMapping')}
        </Button>
      </form>
      <div className="mt-3">
        <ApiErrorAlert error={error} />
      </div>
    </Card>
  );
}

export function LdapProviderActions({ provider }: { provider: LdapProviderDetail }) {
  const t = useTranslations('admin.ldap');
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [result, setResult] = useState<{
    checked: number;
    updated: number;
    disabled: number;
    error: string | null;
  } | null>(null);
  return (
    <Card title={t('maintenance')}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--muted)]">{t('syncHint')}</p>
        {result ? (
          result.error ? (
            <Alert>
              {t('syncFailed')}: {t(`ldapError.${result.error}` as 'ldapError.timeout')}
            </Alert>
          ) : (
            <Alert tone="info">
              {t('syncDone', {
                checked: result.checked,
                updated: result.updated,
                disabled: result.disabled,
              })}
            </Alert>
          )
        ) : null}
        <ApiErrorAlert error={error} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={async () => {
              const res = await run(() =>
                api<NonNullable<typeof result>>(`/ldap/providers/${provider.id}/sync`, {
                  method: 'POST',
                }),
              );
              if (res) setResult(res);
            }}
          >
            {t('syncNow')}
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              if (
                !window.confirm(t('deleteConfirm', { name: provider.name, users: provider.users }))
              )
                return;
              const ok = await run(
                () => api(`/ldap/providers/${provider.id}`, { method: 'DELETE' }).then(() => true),
                { refresh: false },
              );
              if (ok) router.replace('/admin/settings/auth');
            }}
          >
            {t('delete')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
