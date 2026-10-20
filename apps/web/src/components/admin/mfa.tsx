'use client';

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ClientApiError } from '@/lib/client-api';
import { type MfaStatus } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import { Alert, Button, Card, Checkbox, Field, Input } from '../ui/ui';

interface MfaResult {
  ok: true;
  recoveryCodes: string[] | null;
}

/** Erro do navegador ao usar a chave (cancelado, sem suporte...) vira um código traduzido. */
class WebauthnBrowserError extends ClientApiError {
  constructor() {
    super(400, 'webauthn_cancelled', null);
  }
}

async function withBrowser<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ClientApiError) throw error;
    throw new WebauthnBrowserError();
  }
}

/** Depois do MFA o cookie de sessão muda: navegação completa para recarregar tudo. */
function goTo(next: string) {
  window.location.assign(next);
}

function useWebauthnSupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  return supported;
}

// --- Verificação no login -----------------------------------------------------

export function MfaChallenge({
  methods,
  next,
}: {
  methods: ('totp' | 'webauthn')[];
  next: string;
}) {
  const t = useTranslations('admin.mfa');
  const { run, pending, error } = useAction();
  const webauthnSupported = useWebauthnSupport();
  const [mode, setMode] = useState<'totp' | 'recovery'>(
    methods.includes('totp') ? 'totp' : 'recovery',
  );

  async function useKey() {
    const ok = await run(
      async () => {
        const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>(
          '/auth/mfa/webauthn/authenticate/options',
          { method: 'POST' },
        );
        const response = await withBrowser(() => startAuthentication({ optionsJSON }));
        return api<MfaResult>('/auth/mfa/webauthn/authenticate', {
          method: 'POST',
          body: { response },
        });
      },
      { refresh: false },
    );
    if (ok) goTo(next);
  }

  async function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '');
    const ok = await run(
      () => api<MfaResult>('/auth/mfa/verify', { method: 'POST', body: { method: mode, code } }),
      { refresh: false },
    );
    if (ok) goTo(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {methods.includes('webauthn') ? (
        <div className="flex flex-col gap-2">
          <Button onClick={useKey} disabled={pending || !webauthnSupported}>
            {t('useKey')}
          </Button>
          {!webauthnSupported ? <Alert tone="info">{t('noWebauthnSupport')}</Alert> : null}
        </div>
      ) : null}
      <form method="post" onSubmit={submitCode} className="flex flex-col gap-3">
        <Field
          label={mode === 'totp' ? t('totpCode') : t('recoveryCode')}
          hint={mode === 'totp' ? t('totpHint') : t('recoveryHint')}
        >
          <Input
            key={mode}
            name="code"
            required
            autoFocus={!methods.includes('webauthn')}
            autoComplete="one-time-code"
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            pattern={mode === 'totp' ? '[0-9 ]{6,7}' : undefined}
            maxLength={mode === 'totp' ? 7 : 32}
            spellCheck={false}
          />
        </Field>
        <ApiErrorAlert error={error} />
        <Button
          type="submit"
          variant={methods.includes('webauthn') ? 'secondary' : 'primary'}
          disabled={pending}
        >
          {t('verify')}
        </Button>
      </form>
      <button
        type="button"
        className="text-left text-sm text-brand underline"
        onClick={() => setMode(mode === 'totp' ? 'recovery' : 'totp')}
        hidden={!methods.includes('totp') && mode === 'recovery'}
      >
        {mode === 'totp' ? t('useRecovery') : t('useTotp')}
      </button>
    </div>
  );
}

// --- Cadastro -------------------------------------------------------------------

export function TotpEnroll({ onDone }: { onDone: (codes: string[] | null) => void }) {
  const t = useTranslations('admin.mfa');
  const { run, pending, error } = useAction();
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);

  if (!setup) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-[var(--muted)]">{t('totpIntro')}</p>
        <ApiErrorAlert error={error} />
        <div>
          <Button
            disabled={pending}
            onClick={async () => {
              const result = await run(
                () =>
                  api<{ secret: string; qrSvg: string }>('/auth/mfa/totp/setup', {
                    method: 'POST',
                  }),
                { refresh: false },
              );
              if (result) setSetup(result);
            }}
          >
            {t('totpStart')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const code = String(new FormData(event.currentTarget).get('code') ?? '');
        const result = await run(
          () => api<MfaResult>('/auth/mfa/totp/confirm', { method: 'POST', body: { code } }),
          { refresh: false },
        );
        if (result) onDone(result.recoveryCodes);
      }}
    >
      <ol className="list-decimal pl-5 text-sm">
        <li>{t('totpStep1')}</li>
        <li>{t('totpStep2')}</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {/* SVG gerado pela API (biblioteca qrcode); como imagem, não executa nada. */}
        <img
          src={`data:image/svg+xml;base64,${btoa(setup.qrSvg)}`}
          alt={t('qrAlt')}
          width={180}
          height={180}
          className="rounded border border-[var(--border)] bg-white p-2"
        />
        <div className="text-sm">
          <p className="text-[var(--muted)]">{t('manualKey')}</p>
          <code className="break-all font-mono text-xs" data-testid="totp-secret">
            {setup.secret.match(/.{1,4}/g)?.join(' ')}
          </code>
        </div>
      </div>
      <Field label={t('totpCode')}>
        <Input
          name="code"
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
        />
      </Field>
      <ApiErrorAlert error={error} />
      <div>
        <Button type="submit" disabled={pending}>
          {t('totpConfirm')}
        </Button>
      </div>
    </form>
  );
}

export function WebauthnEnroll({ onDone }: { onDone: (codes: string[] | null) => void }) {
  const t = useTranslations('admin.mfa');
  const { run, pending, error } = useAction();
  const supported = useWebauthnSupport();
  if (!supported) return <Alert tone="info">{t('noWebauthnSupport')}</Alert>;
  return (
    <form
      method="post"
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const name = String(new FormData(formElement).get('name') ?? '');
        const result = await run(
          async () => {
            const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>(
              '/auth/mfa/webauthn/register/options',
              { method: 'POST' },
            );
            const response = await withBrowser(() => startRegistration({ optionsJSON }));
            return api<MfaResult>('/auth/mfa/webauthn/register', {
              method: 'POST',
              body: { name, response },
            });
          },
          { refresh: false },
        );
        if (result) {
          formElement.reset();
          onDone(result.recoveryCodes);
        }
      }}
    >
      <p className="text-sm text-[var(--muted)]">{t('webauthnIntro')}</p>
      <Field label={t('keyName')} hint={t('keyNameHint')}>
        <Input name="name" required maxLength={60} defaultValue={t('keyNameDefault')} />
      </Field>
      <ApiErrorAlert error={error} />
      <div>
        <Button type="submit" disabled={pending}>
          {t('addKey')}
        </Button>
      </div>
    </form>
  );
}

/** Códigos de recuperação recém-gerados: mostrados uma única vez. */
export function RecoveryCodes({ codes, onContinue }: { codes: string[]; onContinue: () => void }) {
  const t = useTranslations('admin.mfa');
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">{t('recoveryIntro')}</Alert>
      <ul
        className="grid grid-cols-2 gap-2 rounded-md border border-[var(--border)] p-3 font-mono text-sm"
        data-testid="recovery-codes"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(text)}>
          {t('copy')}
        </Button>
        <a
          className="inline-flex items-center rounded-md border border-[var(--border)] px-3 py-2 text-sm"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text + '\n')}`}
          download="status-page-recovery-codes.txt"
        >
          {t('download')}
        </a>
      </div>
      <Checkbox
        label={t('savedCodes')}
        checked={saved}
        onChange={(e) => setSaved(e.target.checked)}
      />
      <div>
        <Button disabled={!saved} onClick={onContinue}>
          {t('continue')}
        </Button>
      </div>
    </div>
  );
}

/** Cadastro obrigatório pela política, logo após o login. */
export function MfaEnrollment({ next }: { next: string }) {
  const t = useTranslations('admin.mfa');
  const [method, setMethod] = useState<'totp' | 'webauthn'>('totp');
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) return <RecoveryCodes codes={codes} onContinue={() => goTo(next)} />;
  const done = (recovery: string[] | null) => (recovery ? setCodes(recovery) : goTo(next));
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">{t('enrollRequired')}</Alert>
      <div className="flex gap-2" role="tablist">
        {(['totp', 'webauthn'] as const).map((m) => (
          <Button
            key={m}
            role="tab"
            aria-selected={method === m}
            variant={method === m ? 'primary' : 'secondary'}
            onClick={() => setMethod(m)}
          >
            {m === 'totp' ? t('methodTotp') : t('methodWebauthn')}
          </Button>
        ))}
      </div>
      {method === 'totp' ? <TotpEnroll onDone={done} /> : <WebauthnEnroll onDone={done} />}
    </div>
  );
}

// --- Perfil -----------------------------------------------------------------------

export function MfaSettings({ status }: { status: MfaStatus }) {
  const t = useTranslations('admin.mfa');
  const { run, pending, error } = useAction();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [adding, setAdding] = useState<'totp' | 'webauthn' | null>(null);
  const enabled = status.totp || status.webauthn.length > 0;

  const finished = (recovery: string[] | null) => {
    setAdding(null);
    if (recovery) setCodes(recovery);
    else window.location.reload();
  };

  if (codes) {
    return (
      <Card title={t('heading')}>
        <RecoveryCodes codes={codes} onContinue={() => window.location.reload()} />
      </Card>
    );
  }

  return (
    <Card title={t('heading')}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-[var(--muted)]">
          {enabled ? t('enabled') : t('disabled')}
          {status.required ? ` ${t('requiredByPolicy')}` : null}
        </p>

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium">{t('methodTotp')}</h3>
              <p className="text-sm text-[var(--muted)]">
                {status.totp ? t('totpOn') : t('totpOff')}
              </p>
            </div>
            {status.totp ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(t('confirmRemove')))
                    void run(() => api('/auth/mfa/totp', { method: 'DELETE' }));
                }}
              >
                {t('remove')}
              </Button>
            ) : adding !== 'totp' ? (
              <Button variant="secondary" onClick={() => setAdding('totp')}>
                {t('enable')}
              </Button>
            ) : null}
          </div>
          {adding === 'totp' ? <TotpEnroll onDone={finished} /> : null}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{t('methodWebauthn')}</h3>
            {adding !== 'webauthn' ? (
              <Button variant="secondary" onClick={() => setAdding('webauthn')}>
                {t('addKey')}
              </Button>
            ) : null}
          </div>
          {status.webauthn.length > 0 ? (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {status.webauthn.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{key.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {key.rpId} · {t('added')} <LocalTime value={key.createdAt} />
                      {key.lastUsedAt ? (
                        <>
                          {' '}
                          · {t('lastUsed')} <LocalTime value={key.lastUsedAt} />
                        </>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(t('confirmRemove')))
                        void run(() => api(`/auth/mfa/webauthn/${key.id}`, { method: 'DELETE' }));
                    }}
                  >
                    {t('remove')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">{t('noKeys')}</p>
          )}
          {adding === 'webauthn' ? <WebauthnEnroll onDone={finished} /> : null}
        </section>

        {enabled ? (
          <section className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium">{t('recoveryHeading')}</h3>
              <p className="text-sm text-[var(--muted)]">
                {t('recoveryRemaining', { count: status.recoveryCodesRemaining })}
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={async () => {
                if (!window.confirm(t('confirmRegenerate'))) return;
                const result = await run(
                  () =>
                    api<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', {
                      method: 'POST',
                    }),
                  { refresh: false },
                );
                if (result) setCodes(result.recoveryCodes);
              }}
            >
              {t('regenerate')}
            </Button>
          </section>
        ) : null}
        <ApiErrorAlert error={error} />
      </div>
    </Card>
  );
}
