'use client';

import { type Locale, LOCALES, type SubscriberKind } from '@status-page/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Alert, Button, Checkbox, Field, Input, Select } from '../ui/ui';

export interface SubscribeOptions {
  page: { slug: string; name: string };
  kinds: SubscriberKind[];
  components: { id: string; name: string }[];
  consentVersion: string;
}

type Step =
  | { name: 'form' }
  | { name: 'code'; pendingToken: string; target: string }
  | { name: 'telegram'; pendingToken: string; link: string }
  | { name: 'done'; manageToken: string };

const LOCALE_NAMES: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (US)',
  es: 'Español',
};

/** Escolha de componentes e eventos, usada na inscrição e no gerenciamento. */
export function Preferences({
  components,
  allComponents,
  setAllComponents,
  selected,
  setSelected,
  events,
  setEvents,
  locale,
  setLocale,
}: {
  components: { id: string; name: string }[];
  allComponents: boolean;
  setAllComponents: (v: boolean) => void;
  selected: Set<string>;
  setSelected: (v: Set<string>) => void;
  events: Set<string>;
  setEvents: (v: Set<string>) => void;
  locale: string;
  setLocale: (v: string) => void;
}) {
  const t = useTranslations('subscribe');
  const toggle = (set: Set<string>, value: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('components')}</legend>
        <Checkbox
          name="allComponents"
          label={t('allComponents')}
          checked={allComponents}
          onChange={(e) => setAllComponents(e.target.checked)}
        />
        {!allComponents ? (
          <div className="grid gap-2 pl-6 sm:grid-cols-2">
            {components.map((c) => (
              <Checkbox
                key={c.id}
                name={`component-${c.id}`}
                label={c.name}
                checked={selected.has(c.id)}
                onChange={(e) => setSelected(toggle(selected, c.id, e.target.checked))}
              />
            ))}
          </div>
        ) : null}
      </fieldset>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">{t('events')}</legend>
        {(['incident', 'maintenance'] as const).map((e) => (
          <Checkbox
            key={e}
            name={`event-${e}`}
            label={t(`event.${e}`)}
            checked={events.has(e)}
            onChange={(ev) => setEvents(toggle(events, e, ev.target.checked))}
          />
        ))}
      </fieldset>
      <Field label={t('language')}>
        <Select name="locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

export function SubscribeForm({ options }: { options: SubscribeOptions }) {
  const t = useTranslations('subscribe');
  const currentLocale = useLocale();
  const { run, pending, error } = useAction();
  const [kind, setKind] = useState<SubscriberKind>(options.kinds[0] ?? 'email');
  const [step, setStep] = useState<Step>({ name: 'form' });
  const [allComponents, setAllComponents] = useState(true);
  const [selected, setSelected] = useState(new Set<string>());
  const [events, setEvents] = useState(new Set(['incident', 'maintenance']));
  const [locale, setLocale] = useState<string>(currentLocale);
  const [consent, setConsent] = useState(false);
  const slug = options.page.slug;

  if (step.name === 'code')
    return <CodeStep step={step} onDone={(m) => setStep({ name: 'done', manageToken: m })} />;
  if (step.name === 'telegram') {
    return <TelegramStep step={step} onDone={(m) => setStep({ name: 'done', manageToken: m })} />;
  }
  if (step.name === 'done') {
    return (
      <div className="flex flex-col gap-3" data-testid="subscribe-done">
        <Alert tone="info">{t('done', { page: options.page.name })}</Alert>
        <Link
          href={`/p/${slug}/subscription/${step.manageToken}`}
          className="text-[var(--link)] underline"
        >
          {t('manageLink')}
        </Link>
      </div>
    );
  }

  const isWebhook = kind !== 'email' && kind !== 'whatsapp' && kind !== 'telegram';
  return (
    <form
      method="post"
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const target = String(new FormData(event.currentTarget).get('target') ?? '');
        const result = await run(
          () =>
            api<
              | { next: 'code'; pendingToken: string; target: string }
              | { next: 'telegram'; pendingToken: string; link: string }
              | { next: 'active'; manageToken: string }
            >(`/public/pages/${encodeURIComponent(slug)}/subscriptions`, {
              method: 'POST',
              body: {
                kind,
                target,
                locale,
                allComponents,
                componentIds: [...selected],
                events: [...events],
                consent,
              },
            }),
          { refresh: false },
        );
        if (!result) return;
        if (result.next === 'code') setStep({ name: 'code', ...result });
        else if (result.next === 'telegram') setStep({ name: 'telegram', ...result });
        else setStep({ name: 'done', manageToken: result.manageToken });
      }}
    >
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('channel')}>
        {options.kinds.map((k) => (
          <Button
            key={k}
            role="tab"
            aria-selected={kind === k}
            variant={kind === k ? 'primary' : 'secondary'}
            onClick={() => setKind(k)}
          >
            {t(`kind.${k}`)}
          </Button>
        ))}
      </div>

      {kind === 'email' ? (
        <Field label={t('email')}>
          <Input key={kind} name="target" type="email" required autoComplete="email" />
        </Field>
      ) : kind === 'whatsapp' ? (
        <Field label={t('phone')} hint={t('phoneHint')}>
          <Input
            key={kind}
            name="target"
            type="tel"
            required
            placeholder="+55 11 99999-0000"
            autoComplete="tel"
          />
        </Field>
      ) : kind === 'telegram' ? (
        <p className="text-sm text-[var(--muted)]">{t('telegramHint')}</p>
      ) : (
        <Field label={t('webhookUrl')} hint={t(`webhookHint.${kind}` as 'webhookHint.slack')}>
          <Input key={kind} name="target" type="url" required placeholder="https://" />
        </Field>
      )}

      <Preferences
        components={options.components}
        allComponents={allComponents}
        setAllComponents={setAllComponents}
        selected={selected}
        setSelected={setSelected}
        events={events}
        setEvents={setEvents}
        locale={locale}
        setLocale={setLocale}
      />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="consent"
          className="mt-0.5 size-4"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
        />
        <span>{t('consent', { page: options.page.name })}</span>
      </label>
      {isWebhook ? <p className="text-xs text-[var(--muted)]">{t('webhookTest')}</p> : null}
      <ApiErrorAlert error={error} />
      <div>
        <Button type="submit" disabled={pending || !consent || events.size === 0}>
          {pending ? t('sending') : t('submit')}
        </Button>
      </div>
    </form>
  );
}

function CodeStep({
  step,
  onDone,
}: {
  step: { pendingToken: string; target: string };
  onDone: (manageToken: string) => void;
}) {
  const t = useTranslations('subscribe');
  const { run, pending, error } = useAction();
  const resend = useAction();
  const [wait, setWait] = useState(60);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const code = String(new FormData(event.currentTarget).get('code') ?? '');
        const result = await run(
          () =>
            api<{ manageToken: string }>(
              `/public/subscriptions/pending/${step.pendingToken}/confirm`,
              { method: 'POST', body: { code } },
            ),
          { refresh: false },
        );
        if (result) onDone(result.manageToken);
      }}
    >
      <Alert tone="info">{t('codeSent', { target: step.target })}</Alert>
      <Field label={t('code')} hint={t('codeHint')}>
        <Input
          name="code"
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
        />
      </Field>
      <ApiErrorAlert error={error ?? resend.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t('confirm')}
        </Button>
        <Button
          variant="ghost"
          disabled={wait > 0 || resend.pending}
          onClick={async () => {
            const ok = await resend.run(
              () =>
                api(`/public/subscriptions/pending/${step.pendingToken}/resend`, {
                  method: 'POST',
                }).then(() => true),
              { refresh: false },
            );
            if (ok) setWait(60);
          }}
        >
          {wait > 0 ? t('resendIn', { seconds: wait }) : t('resend')}
        </Button>
      </div>
    </form>
  );
}

function TelegramStep({
  step,
  onDone,
}: {
  step: { pendingToken: string; link: string };
  onDone: (manageToken: string) => void;
}) {
  const t = useTranslations('subscribe');
  // Consulta o estado até o /start chegar ao bot.
  useEffect(() => {
    let active = true;
    const poll = async () => {
      while (active) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await api<{ status: string; manageToken?: string }>(
          `/public/subscriptions/pending/${step.pendingToken}`,
        ).catch(() => null);
        if (res?.status === 'active' && res.manageToken) {
          onDone(res.manageToken);
          return;
        }
      }
    };
    void poll();
    return () => {
      active = false;
    };
  }, [step.pendingToken, onDone]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">{t('telegramStep')}</p>
      <div>
        <a
          href={step.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-md bg-[#229ED9] px-4 py-2 text-sm font-medium text-white"
        >
          {t('openTelegram')}
        </a>
      </div>
      <p className="text-xs text-[var(--muted)]">{t('telegramWaiting')}</p>
    </div>
  );
}

// --- Gerenciamento ---------------------------------------------------------------------

export interface ManagedSubscription {
  page: { slug: string; name: string };
  kind: SubscriberKind;
  target: string | null;
  status: 'pending' | 'active' | 'unsubscribed';
  locale: string;
  allComponents: boolean;
  componentIds: string[];
  events: string[];
  components: { id: string; name: string }[];
}

export function ManageSubscription({
  token,
  initial,
  askUnsubscribe,
}: {
  token: string;
  initial: ManagedSubscription;
  askUnsubscribe: boolean;
}) {
  const t = useTranslations('subscribe');
  const { run, pending, error } = useAction();
  const [data, setData] = useState(initial);
  const [allComponents, setAllComponents] = useState(initial.allComponents);
  const [selected, setSelected] = useState(new Set(initial.componentIds));
  const [events, setEvents] = useState(new Set(initial.events));
  const [locale, setLocale] = useState(initial.locale);
  const [saved, setSaved] = useState(false);
  const [erased, setErased] = useState(false);

  if (erased) return <Alert tone="info">{t('erased')}</Alert>;

  const unsubscribe = async () => {
    const result = await run(
      () =>
        api<ManagedSubscription>(`/public/subscriptions/${token}/unsubscribe`, { method: 'POST' }),
      { refresh: false },
    );
    if (result) setData(result);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="text-sm">
        <p>
          <span className="font-medium">{t(`kind.${data.kind}`)}</span>
          {data.target ? ` · ${data.target}` : null}
        </p>
        <p className="text-[var(--muted)]" data-testid="subscription-status">
          {t(`status.${data.status}`)}
        </p>
      </div>

      {data.status === 'active' && askUnsubscribe ? (
        <div className="flex flex-col gap-3 rounded-md border border-[var(--border)] p-4">
          <p>{t('unsubscribeConfirm', { page: data.page.name })}</p>
          <div>
            <Button variant="danger" disabled={pending} onClick={unsubscribe}>
              {t('unsubscribe')}
            </Button>
          </div>
        </div>
      ) : null}

      <form
        method="post"
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaved(false);
          const result = await run(
            () =>
              api<ManagedSubscription>(`/public/subscriptions/${token}`, {
                method: 'PUT',
                body: { locale, allComponents, componentIds: [...selected], events: [...events] },
              }),
            { refresh: false },
          );
          if (result) {
            setData(result);
            setSaved(true);
          }
        }}
      >
        <Preferences
          components={data.components}
          allComponents={allComponents}
          setAllComponents={setAllComponents}
          selected={selected}
          setSelected={setSelected}
          events={events}
          setEvents={setEvents}
          locale={locale}
          setLocale={setLocale}
        />
        <ApiErrorAlert error={error} />
        {saved ? <Alert tone="info">{t('saved')}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || events.size === 0}>
            {t('save')}
          </Button>
          {data.status === 'active' && !askUnsubscribe ? (
            <Button variant="secondary" disabled={pending} onClick={unsubscribe}>
              {t('unsubscribe')}
            </Button>
          ) : null}
        </div>
      </form>

      <section className="flex flex-col gap-2 border-t border-[var(--border)] pt-4 text-sm">
        <h2 className="font-medium">{t('privacy')}</h2>
        <p className="text-[var(--muted)]">{t('eraseHint')}</p>
        <div>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={async () => {
              if (!window.confirm(t('eraseConfirm'))) return;
              const ok = await run(
                () => api(`/public/subscriptions/${token}`, { method: 'DELETE' }).then(() => true),
                { refresh: false },
              );
              if (ok) setErased(true);
            }}
          >
            {t('erase')}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function AcceptInvite({ token, slug }: { token: string; slug: string }) {
  const t = useTranslations('subscribe');
  const { run, pending, error } = useAction();
  const [manageToken, setManageToken] = useState<string | null>(null);
  if (manageToken) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="info">{t('inviteDone')}</Alert>
        <Link
          href={`/p/${slug}/subscription/${manageToken}`}
          className="text-[var(--link)] underline"
        >
          {t('manageLink')}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p>{t('inviteText')}</p>
      <ApiErrorAlert error={error} />
      <div>
        <Button
          disabled={pending}
          onClick={async () => {
            const res = await run(
              () =>
                api<{ manageToken: string }>(`/public/subscriptions/invite/${token}`, {
                  method: 'POST',
                }),
              { refresh: false },
            );
            if (res) setManageToken(res.manageToken);
          }}
        >
          {t('inviteAccept')}
        </Button>
      </div>
    </div>
  );
}
