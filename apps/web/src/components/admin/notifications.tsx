'use client';

import {
  LOCALES,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_KINDS,
  type NotificationEventType,
  type NotificationKind,
  TEMPLATE_VARIABLES,
} from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { api } from '@/lib/client-api';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from '../ui/ui';

export interface TeamChannel {
  id: string;
  kind: NotificationKind;
  name: string;
  enabled: boolean;
  events: string[];
  locale: string;
  config: Record<string, unknown>;
  lastTestAt: string | null;
  lastTestError: string | null;
}

// --- Canais da equipe -------------------------------------------------------------------

/** Campos de configuração de cada tipo de canal. */
function ConfigFields({
  kind,
  config,
  editing,
}: {
  kind: NotificationKind;
  config: Record<string, unknown>;
  editing: boolean;
}) {
  const t = useTranslations('admin.notifications');
  const keep = editing ? t('keepSecret') : undefined;
  switch (kind) {
    case 'email':
      return (
        <Field label={t('field.recipients')} hint={t('field.recipientsHint')}>
          <Textarea
            name="recipients"
            required
            className="min-h-16"
            defaultValue={((config.recipients as string[] | undefined) ?? []).join('\n')}
          />
        </Field>
      );
    case 'telegram':
      return (
        <Field label={t('field.chatId')} hint={t('field.chatIdHint')}>
          <Input name="chatId" required defaultValue={String(config.chatId ?? '')} />
        </Field>
      );
    case 'whatsapp':
      return (
        <Field label={t('field.phones')} hint={t('field.phonesHint')}>
          <Textarea
            name="phones"
            required
            className="min-h-16"
            defaultValue={((config.phones as string[] | undefined) ?? []).join('\n')}
          />
        </Field>
      );
    case 'webhook':
      return (
        <>
          <Field label={t('field.url')} hint={keep}>
            <Input
              name="url"
              type="url"
              required={!editing}
              placeholder={editing ? String(config.url ?? '') : 'https://'}
            />
          </Field>
          <Field label={t('field.secret')} hint={editing ? keep : t('field.secretHint')}>
            <Input
              name="secret"
              autoComplete="off"
              placeholder={editing && config.secret ? '••••' : ''}
            />
          </Field>
        </>
      );
    default:
      return (
        <Field
          label={t('field.webhookUrl')}
          hint={keep ?? t(`field.hint.${kind}` as 'field.hint.slack')}
        >
          <Input
            name="webhookUrl"
            type="url"
            required={!editing}
            placeholder={editing ? String(config.webhookUrl ?? '') : 'https://'}
          />
        </Field>
      );
  }
}

function readConfig(kind: NotificationKind, form: FormData): Record<string, unknown> {
  const lines = (name: string) =>
    String(form.get(name) ?? '')
      .split(/[\n,;]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  switch (kind) {
    case 'email':
      return { recipients: lines('recipients') };
    case 'telegram':
      return { chatId: String(form.get('chatId') ?? '').trim() };
    case 'whatsapp':
      return { phones: lines('phones') };
    case 'webhook':
      return { url: String(form.get('url') ?? ''), secret: String(form.get('secret') ?? '') };
    default:
      return { webhookUrl: String(form.get('webhookUrl') ?? '') };
  }
}

function ChannelForm({
  pageId,
  channel,
  onDone,
}: {
  pageId: string;
  channel?: TeamChannel;
  onDone: () => void;
}) {
  const t = useTranslations('admin.notifications');
  const tKind = useTranslations('admin.notifications.kind');
  const tEvent = useTranslations('admin.notifications.eventType');
  const { run, pending, error } = useAction();
  const [kind, setKind] = useState<NotificationKind>(channel?.kind ?? 'slack');
  return (
    <form
      method="post"
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const body = {
          name: form.get('name'),
          enabled: form.get('enabled') === 'on',
          // Webhook genérico pode escolher eventos específicos; os demais, as categorias.
          events:
            kind === 'webhook' && form.getAll('eventType').length > 0
              ? form.getAll('eventType')
              : ['incident', 'maintenance'].filter((e) => form.get(`event-${e}`) === 'on'),
          locale: form.get('locale'),
          config: readConfig(kind, form),
        };
        const ok = await run(() =>
          (channel
            ? api(`/pages/${pageId}/notification-channels/${channel.id}`, { method: 'PUT', body })
            : api(`/pages/${pageId}/notification-channels`, {
                method: 'POST',
                body: { ...body, kind },
              })
          ).then(() => true),
        );
        if (ok) onDone();
      }}
    >
      {!channel ? (
        <Field label={t('kindLabel')}>
          <Select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as NotificationKind)}
          >
            {NOTIFICATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKind(k)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t('name')}>
        <Input
          name="name"
          required
          maxLength={120}
          defaultValue={channel?.name ?? ''}
          placeholder={t('namePlaceholder')}
        />
      </Field>
      <div className="sm:col-span-2">
        <ConfigFields
          key={kind}
          kind={kind}
          config={channel?.config ?? {}}
          editing={Boolean(channel)}
        />
      </div>
      <fieldset className="flex flex-wrap items-center gap-4">
        <legend className="mb-1 text-sm font-medium">{t('events')}</legend>
        {(['incident', 'maintenance'] as const).map((e) => (
          <Checkbox
            key={e}
            name={`event-${e}`}
            label={t(`event.${e}`)}
            defaultChecked={channel ? channel.events.includes(e) : true}
          />
        ))}
      </fieldset>
      {kind === 'webhook' ? (
        <details className="sm:col-span-2" open={channel?.events.some((e) => e.includes('_'))}>
          <summary className="cursor-pointer text-sm font-medium">{t('specificEvents')}</summary>
          <p className="mt-1 text-xs text-[var(--muted)]">{t('specificEventsHint')}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {NOTIFICATION_EVENT_TYPES.map((ev) => (
              <Checkbox
                key={ev}
                name="eventType"
                value={ev}
                label={tEvent(ev)}
                defaultChecked={channel?.events.includes(ev) ?? false}
              />
            ))}
          </div>
        </details>
      ) : null}
      <Field label={t('locale')}>
        <Select name="locale" defaultValue={channel?.locale ?? 'pt-BR'}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox name="enabled" label={t('enabled')} defaultChecked={channel?.enabled ?? true} />
      <div className="sm:col-span-2">
        <ApiErrorAlert error={error} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {channel ? t('save') : t('add')}
        </Button>
        {channel ? (
          <Button variant="ghost" onClick={onDone}>
            {t('cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function ChannelsManager({ pageId, channels }: { pageId: string; channels: TeamChannel[] }) {
  const t = useTranslations('admin.notifications');
  const tKind = useTranslations('admin.notifications.kind');
  const tEvent = useTranslations('admin.notifications.eventType');
  const { run, pending, error } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <Card title={t('channelsHeading')}>
        <p className="mb-3 text-sm text-[var(--muted)]">{t('channelsHint')}</p>
        {channels.length === 0 ? (
          <EmptyState>{t('noChannels')}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {channels.map((c) =>
              editing === c.id ? (
                <li key={c.id} className="py-3">
                  <ChannelForm pageId={pageId} channel={c} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                  data-testid="channel-row"
                >
                  <div>
                    <p className="font-medium">
                      {c.name}
                      {!c.enabled ? (
                        <span className="ml-2 text-xs text-[var(--muted)]">
                          {t('disabledBadge')}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {tKind(c.kind)} ·{' '}
                      {c.events
                        .map((e) =>
                          e.includes('_')
                            ? tEvent(e as NotificationEventType)
                            : t(`event.${e}` as 'event.incident'),
                        )
                        .join(', ')}{' '}
                      · {c.locale}
                    </p>
                    {results[c.id] ? (
                      <p
                        className={
                          results[c.id]!.ok
                            ? 'text-xs text-status-operational'
                            : 'text-xs text-status-major_outage'
                        }
                      >
                        {results[c.id]!.ok
                          ? t('testOk')
                          : `${t('testFailed')}: ${results[c.id]!.error}`}
                      </p>
                    ) : c.lastTestAt ? (
                      <p className="text-xs text-[var(--muted)]">
                        {t('lastTest')} <LocalTime value={c.lastTestAt} />
                        {c.lastTestError ? ` — ${c.lastTestError}` : ` — ${t('testOk')}`}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={async () => {
                        const res = await run(
                          () =>
                            api<{ ok: boolean; error?: string }>(
                              `/pages/${pageId}/notification-channels/${c.id}/test`,
                              { method: 'POST' },
                            ),
                          { refresh: false },
                        );
                        if (res) setResults((r) => ({ ...r, [c.id]: res }));
                      }}
                    >
                      {t('sendTest')}
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(c.id)}>
                      {t('edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(t('removeConfirm', { name: c.name })))
                          void run(() =>
                            api(`/pages/${pageId}/notification-channels/${c.id}`, {
                              method: 'DELETE',
                            }),
                          );
                      }}
                    >
                      {t('remove')}
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
        <ApiErrorAlert error={error} />
      </Card>
      <Card title={t('newChannel')}>
        <ChannelForm key={formKey} pageId={pageId} onDone={() => setFormKey((k) => k + 1)} />
      </Card>
    </div>
  );
}

// --- Assinantes -----------------------------------------------------------------------

export interface SubscriberRow {
  id: string;
  kind: NotificationKind;
  targetDisplay: string | null;
  locale: string;
  status: 'pending' | 'active' | 'unsubscribed';
  source: string;
  allComponents: boolean;
  eventTypes: string[];
  componentCount: number;
  confirmedAt: string | null;
  createdAt: string;
}

export function SubscribersManager({
  pageId,
  data,
}: {
  pageId: string;
  data: { items: SubscriberRow[]; counts: Record<string, number> };
}) {
  const t = useTranslations('admin.notifications');
  const tKind = useTranslations('admin.notifications.kind');
  const { run, pending, error } = useAction();
  const [result, setResult] = useState<{
    invited: number;
    skipped: number;
    invalid: number[];
  } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('subscribersHeading')}
        actions={
          <a
            href={`/api/pages/${pageId}/subscribers/export.csv`}
            className="text-sm text-brand"
            download
          >
            {t('export')}
          </a>
        }
      >
        <p className="mb-3 text-sm text-[var(--muted)]" data-testid="subscriber-counts">
          {(['active', 'pending', 'unsubscribed'] as const)
            .map((s) => `${t(`subStatus.${s}`)}: ${data.counts[s] ?? 0}`)
            .join(' · ')}
        </p>
        {data.items.length === 0 ? (
          <EmptyState>{t('noSubscribers')}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--muted)]">
                <tr>
                  <th className="py-2 pr-3">{t('col.contact')}</th>
                  <th className="py-2 pr-3">{t('col.status')}</th>
                  <th className="py-2 pr-3">{t('col.scope')}</th>
                  <th className="py-2 pr-3">{t('col.since')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.items.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-3">
                      <p>{s.targetDisplay ?? '—'}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {tKind(s.kind)} · {s.locale}
                        {s.source === 'import' ? ` · ${t('imported')}` : ''}
                      </p>
                    </td>
                    <td className="py-2 pr-3">{t(`subStatus.${s.status}`)}</td>
                    <td className="py-2 pr-3 text-xs">
                      {s.allComponents
                        ? t('allComponents')
                        : t('someComponents', { count: s.componentCount })}
                      <br />
                      {s.eventTypes.map((e) => t(`event.${e}` as 'event.incident')).join(', ')}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <LocalTime value={s.confirmedAt ?? s.createdAt} />
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(t('removeSubscriberConfirm')))
                            void run(() =>
                              api(`/pages/${pageId}/subscribers/${s.id}`, { method: 'DELETE' }),
                            );
                        }}
                      >
                        {t('remove')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ApiErrorAlert error={error} />
      </Card>
      <Card title={t('importHeading')}>
        <form
          method="post"
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const file = (event.currentTarget.elements.namedItem('file') as HTMLInputElement)
              .files?.[0];
            if (!file) return;
            const csv = await file.text();
            setResult(null);
            const res = await run(() =>
              api<{ invited: number; skipped: number; invalid: number[] }>(
                `/pages/${pageId}/subscribers/import`,
                { method: 'POST', body: { csv } },
              ),
            );
            if (res) setResult(res);
          }}
        >
          <p className="text-sm text-[var(--muted)]">{t('importHint')}</p>
          <Input name="file" type="file" accept=".csv,text/csv" required />
          {result ? (
            <Alert tone="info">
              {t('importResult', {
                invited: result.invited,
                skipped: result.skipped,
                invalid: result.invalid.length,
              })}
              {result.invalid.length ? ` (${t('lines')}: ${result.invalid.join(', ')})` : null}
            </Alert>
          ) : null}
          <div>
            <Button type="submit" disabled={pending}>
              {t('import')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// --- Entregas -------------------------------------------------------------------------

export interface DeliveryRow {
  id: string;
  kind: NotificationKind;
  target: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  recipient: 'channel' | 'subscriber';
  event: { type: NotificationEventType; title: string; createdAt: string } | null;
}

const STATUS_CLASS: Record<DeliveryRow['status'], string> = {
  sent: 'text-status-operational',
  pending: 'text-status-degraded_performance',
  failed: 'text-status-major_outage',
  skipped: 'text-[var(--muted)]',
};

export function DeliveriesLog({
  pageId,
  initial,
  canResend,
}: {
  pageId: string;
  initial: { items: DeliveryRow[]; nextCursor?: string };
  canResend: boolean;
}) {
  const t = useTranslations('admin.notifications');
  const tKind = useTranslations('admin.notifications.kind');
  const tEvent = useTranslations('admin.notifications.eventType');
  const { run, pending, error } = useAction();
  const [status, setStatus] = useState('');
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);

  const load = async (nextStatus: string, after?: string) => {
    const params = new URLSearchParams({ limit: '50' });
    if (nextStatus) params.set('status', nextStatus);
    if (after) params.set('cursor', after);
    const res = await run(
      () =>
        api<{ items: DeliveryRow[]; nextCursor?: string }>(
          `/pages/${pageId}/notification-deliveries?${params}`,
        ),
      { refresh: false },
    );
    if (!res) return;
    setItems(after ? [...items, ...res.items] : res.items);
    setCursor(res.nextCursor);
  };

  return (
    <Card
      title={t('deliveriesHeading')}
      actions={
        <div className="w-44">
          <Select
            aria-label={t('col.status')}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              void load(e.target.value);
            }}
          >
            <option value="">{t('allStatuses')}</option>
            {(['sent', 'pending', 'failed', 'skipped'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`deliveryStatus.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      {items.length === 0 ? (
        <EmptyState>{t('noDeliveries')}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="deliveries">
            <thead className="text-xs text-[var(--muted)]">
              <tr>
                <th className="py-2 pr-3">{t('col.when')}</th>
                <th className="py-2 pr-3">{t('col.event')}</th>
                <th className="py-2 pr-3">{t('col.recipient')}</th>
                <th className="py-2 pr-3">{t('col.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 pr-3 text-xs">
                    <LocalTime value={d.sentAt ?? d.createdAt} />
                  </td>
                  <td className="py-2 pr-3">
                    {d.event ? (
                      <>
                        <p>{d.event.title}</p>
                        <p className="text-xs text-[var(--muted)]">{tEvent(d.event.type)}</p>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <p>{d.target}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {tKind(d.kind)} · {d.recipient === 'channel' ? t('team') : t('subscriber')}
                    </p>
                  </td>
                  <td className="py-2 pr-3">
                    <p className={STATUS_CLASS[d.status]}>{t(`deliveryStatus.${d.status}`)}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {t('attempts', { count: d.attempts })}
                      {d.lastError ? ` — ${d.lastError}` : ''}
                    </p>
                  </td>
                  <td className="py-2 text-right">
                    {canResend && d.status !== 'pending' ? (
                      <Button
                        variant="ghost"
                        disabled={pending}
                        onClick={async () => {
                          const ok = await run(
                            () =>
                              api(`/pages/${pageId}/notification-deliveries/${d.id}/resend`, {
                                method: 'POST',
                              }).then(() => true),
                            { refresh: false },
                          );
                          if (ok)
                            setItems(
                              items.map((i) =>
                                i.id === d.id ? { ...i, status: 'pending', lastError: null } : i,
                              ),
                            );
                        }}
                      >
                        {t('resend')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ApiErrorAlert error={error} />
      {cursor ? (
        <div className="mt-3">
          <Button variant="secondary" disabled={pending} onClick={() => load(status, cursor)}>
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

// --- Templates de mensagem -------------------------------------------------------------

export interface TemplatesData {
  saved: {
    id: string;
    channel: string;
    event: NotificationEventType;
    locale: string;
    subject: string | null;
    body: string;
  }[];
  defaults: Record<string, Record<NotificationEventType, { subject: string; body: string }>>;
}

export function TemplatesEditor({ pageId, data }: { pageId: string; data: TemplatesData }) {
  const t = useTranslations('admin.notifications');
  const tKind = useTranslations('admin.notifications.kind');
  const tEvent = useTranslations('admin.notifications.eventType');
  const { run, pending, error } = useAction();
  const [event, setEvent] = useState<NotificationEventType>('incident_created');
  const [locale, setLocale] = useState<string>('pt-BR');
  const [channel, setChannel] = useState<string>('all');
  const saved = data.saved.find(
    (s) => s.event === event && s.locale === locale && s.channel === channel,
  );
  const fallback = data.defaults[locale]![event];
  const [subject, setSubject] = useState(saved?.subject ?? fallback.subject);
  const [body, setBody] = useState(saved?.body ?? fallback.body);
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);
  const key = `${event}|${locale}|${channel}`;
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) {
    // Trocou o evento/idioma/canal: carrega o salvo ou o padrão.
    setLoadedKey(key);
    setSubject(saved?.subject ?? fallback.subject);
    setBody(saved?.body ?? fallback.body);
    setPreview(null);
  }
  const customized = useMemo(
    () =>
      data.saved.map(
        (s) =>
          `${tEvent(s.event)} · ${s.locale} · ${s.channel === 'all' ? t('allChannels') : tKind(s.channel as NotificationKind)}`,
      ),
    [data.saved, t, tEvent, tKind],
  );
  const body_ = { channel, event, locale, subject, body };

  return (
    <div className="flex flex-col gap-6">
      <Card title={t('templatesHeading')}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--muted)]">{t('templatesHint')}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('col.event')}>
              <Select
                name="event"
                value={event}
                onChange={(e) => setEvent(e.target.value as NotificationEventType)}
              >
                {NOTIFICATION_EVENT_TYPES.map((ev) => (
                  <option key={ev} value={ev}>
                    {tEvent(ev)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('locale')}>
              <Select name="locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('channelLabel')}>
              <Select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="all">{t('allChannels')}</option>
                {NOTIFICATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {tKind(k)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t('subject')}>
            <Input
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
            />
          </Field>
          <Field
            label={t('body')}
            hint={t('variables', { list: TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(' ') })}
          >
            <Textarea
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-40 font-mono text-xs"
            />
          </Field>
          {preview ? (
            <div
              className="rounded-md border border-[var(--border)] p-3 text-sm"
              data-testid="template-preview"
            >
              <p className="font-medium">{preview.subject}</p>
              <p className="mt-2 whitespace-pre-line">{preview.text}</p>
            </div>
          ) : null}
          <ApiErrorAlert error={error} />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={() =>
                run(() =>
                  api(`/pages/${pageId}/notification-templates`, { method: 'PUT', body: body_ }),
                )
              }
            >
              {t('saveTemplate')}
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={async () => {
                const res = await run(
                  () =>
                    api<{ subject: string; text: string }>(
                      `/pages/${pageId}/notification-templates/preview`,
                      {
                        method: 'POST',
                        body: body_,
                      },
                    ),
                  { refresh: false },
                );
                if (res) setPreview(res);
              }}
            >
              {t('preview')}
            </Button>
            {saved ? (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    api(`/pages/${pageId}/notification-templates/${saved.id}`, {
                      method: 'DELETE',
                    }),
                  )
                }
              >
                {t('restoreDefault')}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
      {customized.length ? (
        <Card title={t('customized')}>
          <ul className="list-disc pl-5 text-sm">
            {customized.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
