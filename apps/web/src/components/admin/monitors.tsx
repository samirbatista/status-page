'use client';

import {
  AUTOMATION_MODES,
  DNS_RECORD_TYPES,
  FAILURE_STATUSES,
  MIN_INTERVAL_SECONDS,
  MONITOR_TYPES,
} from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import {
  type CheckResult,
  type IncidentTemplate,
  type Monitor,
  type MonitorType,
} from '@/lib/types';
import { useFieldErrors } from '@/lib/field-errors';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  cx,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from '../ui/ui';

type Option = { id: string; name: string };

const STATE_CLASS: Record<Monitor['state'], string> = {
  up: 'bg-status-operational',
  down: 'bg-status-major_outage',
  unknown: 'bg-[var(--border)]',
};

export function MonitorStateBadge({ monitor }: { monitor: Monitor }) {
  const t = useTranslations('admin.monitors');
  const state = monitor.enabled ? monitor.state : 'unknown';
  return (
    <span className="inline-flex items-center gap-2 text-sm" data-state={state}>
      <span className={cx('size-2.5 rounded-full', STATE_CLASS[state])} />
      {monitor.enabled ? t(`state.${monitor.state}`) : t('paused')}
    </span>
  );
}

export function MonitorsManager({
  pageId,
  monitors,
  components,
  templates,
  canEdit,
}: {
  pageId: string;
  monitors: Monitor[];
  components: Option[];
  templates: IncidentTemplate[];
  canEdit: boolean;
}) {
  const t = useTranslations('admin.monitors');
  const [creating, setCreating] = useState(false);
  const base = `/admin/pages/${pageId}/monitors`;

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('heading')}
        actions={
          canEdit ? (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              + {t('new')}
            </Button>
          ) : null
        }
      >
        {monitors.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {monitors.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={`${base}/${m.id}`} className="font-medium hover:underline">
                    {m.name}
                  </Link>
                  <p className="truncate text-sm text-[var(--muted)]">
                    {t(`type.${m.type}`)} · {m.target}
                    {m.component ? ` → ${m.component.name}` : ` · ${t('noComponent')}`}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {m.lastLatencyMs !== null && m.state === 'up' ? (
                    <span className="text-[var(--muted)]">{m.lastLatencyMs} ms</span>
                  ) : null}
                  <MonitorStateBadge monitor={m} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating ? (
        <Card title={t('new')}>
          <MonitorForm
            pageId={pageId}
            monitor={null}
            components={components}
            templates={templates}
            onDone={() => setCreating(false)}
          />
        </Card>
      ) : null}
    </div>
  );
}

/** Linhas "Nome: valor" ↔ objeto de cabeçalhos. */
function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return headers;
}

const str = (v: unknown, fallback = '') => (v === undefined || v === null ? fallback : String(v));

export function MonitorForm({
  pageId,
  monitor,
  components,
  templates,
  onDone,
}: {
  pageId: string;
  monitor: Monitor | null;
  components: Option[];
  templates: IncidentTemplate[];
  onDone?: () => void;
}) {
  const t = useTranslations();
  const tm = useTranslations('admin.monitors');
  const router = useRouter();
  const { run, pending, error } = useAction();
  const test = useAction();
  const [type, setType] = useState<MonitorType>(monitor?.type ?? 'http');
  const [method, setMethod] = useState(str(monitor?.config.method, 'GET'));
  const [result, setResult] = useState<CheckResult | null>(null);
  const config = monitor?.config ?? {};
  // Erros de validação da API (salvar ou testar), mostrados no próprio campo.
  const fields = useFieldErrors(error ?? test.error, (path) => {
    if (path.startsWith('headers')) return 'headers';
    if (path === 'timeoutMs') return 'timeoutSeconds';
    if (path === 'config.body') return 'requestBody';
    if (path === 'config.port') return type === 'ssl' ? 'sslPort' : 'port';
    if (path.startsWith('config.')) return path.slice('config.'.length);
    return path;
  });

  function collect(form: HTMLFormElement) {
    const data = new FormData(form);
    const get = (k: string) => String(data.get(k) ?? '');
    const flag = (k: string) => data.get(k) === 'on';
    const configByType: Record<MonitorType, Record<string, unknown>> = {
      http: {
        method: get('method'),
        expectedStatus: get('expectedStatus') || '200-399',
        keyword: get('keyword'),
        keywordAbsent: flag('keywordAbsent'),
        followRedirects: flag('followRedirects'),
        verifyTls: flag('verifyTls'),
        body: get('requestBody'),
      },
      tcp: { port: Number(get('port')) },
      icmp: {},
      dns: { recordType: get('recordType'), expected: get('expected'), server: get('server') },
      ssl: { port: Number(get('sslPort') || 443), minDaysLeft: Number(get('minDaysLeft') || 14) },
    };
    const headersText = get('headers').trim();
    let headers: Record<string, string> | undefined;
    if (type === 'http') {
      if (flag('clearHeaders')) headers = {};
      else if (headersText || !monitor) headers = parseHeaders(headersText);
    }
    return {
      name: get('name'),
      type,
      target: get('target').trim(),
      componentId: get('componentId') || null,
      intervalSeconds: Number(get('intervalSeconds')),
      timeoutMs: Number(get('timeoutSeconds')) * 1000,
      failureThreshold: Number(get('failureThreshold')),
      recoveryThreshold: Number(get('recoveryThreshold')),
      mode: get('mode'),
      failureStatus: get('failureStatus'),
      templateId: get('templateId') || null,
      publicMetrics: flag('publicMetrics'),
      enabled: flag('enabled'),
      headers,
      config: configByType[type],
    };
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = collect(event.currentTarget);
    const saved = await run(() =>
      monitor
        ? api<Monitor>(`/pages/${pageId}/monitors/${monitor.id}`, { method: 'PUT', body })
        : api<Monitor>(`/pages/${pageId}/monitors`, { method: 'POST', body }),
    );
    if (saved) onDone?.();
  }

  async function onTest(form: HTMLFormElement | null) {
    if (!form || !form.reportValidity()) return;
    setResult(null);
    const body = collect(form);
    const res = await test.run(
      () =>
        api<CheckResult>(
          monitor
            ? `/pages/${pageId}/monitors/${monitor.id}/test`
            : `/pages/${pageId}/monitors/test`,
          { method: 'POST', body },
        ),
      { refresh: false },
    );
    if (res) setResult(res);
  }

  const targetHint: Record<MonitorType, string> = {
    http: 'https://api.exemplo.com/health',
    tcp: 'db.interno',
    icmp: '10.0.0.1',
    dns: 'exemplo.com',
    ssl: 'exemplo.com',
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={tm('form')}>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field label={tm('name')} required error={fields.get('name')}>
          <Input name="name" defaultValue={monitor?.name} required maxLength={120} />
        </Field>
        <Field label={tm('typeLabel')} required error={fields.get('type')}>
          <Select
            name="type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as MonitorType);
              setResult(null);
            }}
          >
            {MONITOR_TYPES.map((v) => (
              <option key={v} value={v}>
                {tm(`type.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={tm(`target.${type}`)} required error={fields.get('target')}>
        <Input
          name="target"
          defaultValue={monitor?.target}
          required
          maxLength={2048}
          placeholder={targetHint[type]}
        />
      </Field>

      {type === 'http' ? (
        <fieldset className="grid gap-4 rounded-md border border-[var(--border)] p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">{tm('httpOptions')}</legend>
          <Field label={tm('method')} error={fields.get('method')}>
            <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>GET</option>
              <option>HEAD</option>
              <option>POST</option>
            </Select>
          </Field>
          <Field
            label={tm('expectedStatus')}
            hint={tm('expectedStatusHint')}
            error={fields.get('expectedStatus')}
          >
            <Input name="expectedStatus" defaultValue={str(config.expectedStatus, '200-399')} />
          </Field>
          <Field label={tm('keyword')} hint={tm('keywordHint')} error={fields.get('keyword')}>
            <Input name="keyword" defaultValue={str(config.keyword)} maxLength={500} />
          </Field>
          <div className="flex flex-col gap-2 sm:col-span-3">
            <Checkbox
              name="keywordAbsent"
              label={tm('keywordAbsent')}
              defaultChecked={Boolean(config.keywordAbsent)}
            />
            <Checkbox
              name="followRedirects"
              label={tm('followRedirects')}
              defaultChecked={config.followRedirects !== false}
            />
            <Checkbox
              name="verifyTls"
              label={tm('verifyTls')}
              defaultChecked={config.verifyTls !== false}
            />
          </div>
          {method === 'POST' ? (
            <Field
              label={tm('requestBody')}
              className="sm:col-span-3"
              error={fields.get('requestBody')}
            >
              <Textarea name="requestBody" defaultValue={str(config.body)} maxLength={10_000} />
            </Field>
          ) : null}
          <Field
            label={tm('headers')}
            error={fields.get('headers')}
            hint={
              monitor?.headerNames.length
                ? tm('headersKeep', { names: monitor.headerNames.join(', ') })
                : tm('headersHint')
            }
            className="sm:col-span-3"
          >
            <Textarea
              name="headers"
              className="min-h-16 font-mono"
              placeholder="Authorization: Bearer …"
              autoComplete="off"
            />
          </Field>
          {monitor?.headerNames.length ? (
            <Checkbox name="clearHeaders" label={tm('clearHeaders')} />
          ) : null}
        </fieldset>
      ) : null}
      {type === 'tcp' ? (
        <Field label={tm('port')} className="max-w-40" required error={fields.get('port')}>
          <Input
            name="port"
            type="number"
            min={1}
            max={65535}
            required
            defaultValue={str(config.port)}
          />
        </Field>
      ) : null}
      {type === 'dns' ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tm('recordType')} error={fields.get('recordType')}>
            <Select name="recordType" defaultValue={str(config.recordType, 'A')}>
              {DNS_RECORD_TYPES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label={tm('expected')} hint={tm('expectedHint')} error={fields.get('expected')}>
            <Input name="expected" defaultValue={str(config.expected)} />
          </Field>
          <Field label={tm('dnsServer')} hint={tm('dnsServerHint')} error={fields.get('server')}>
            <Input name="server" defaultValue={str(config.server)} placeholder="1.1.1.1" />
          </Field>
        </div>
      ) : null}
      {type === 'ssl' ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tm('port')} error={fields.get('sslPort')}>
            <Input
              name="sslPort"
              type="number"
              min={1}
              max={65535}
              defaultValue={str(config.port, '443')}
            />
          </Field>
          <Field label={tm('minDaysLeft')} error={fields.get('minDaysLeft')}>
            <Input
              name="minDaysLeft"
              type="number"
              min={0}
              max={365}
              defaultValue={str(config.minDaysLeft, '14')}
            />
          </Field>
        </div>
      ) : null}
      {type === 'icmp' ? <Alert tone="info">{tm('icmpHint')}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-4">
        <Field
          label={tm('interval')}
          hint={tm('intervalHint', { min: MIN_INTERVAL_SECONDS })}
          required
          error={fields.get('intervalSeconds')}
        >
          <Input
            name="intervalSeconds"
            type="number"
            required
            min={MIN_INTERVAL_SECONDS}
            max={86400}
            defaultValue={monitor?.intervalSeconds ?? 60}
          />
        </Field>
        <Field label={tm('timeout')} required error={fields.get('timeoutSeconds')}>
          <Input
            name="timeoutSeconds"
            type="number"
            required
            min={1}
            max={60}
            defaultValue={(monitor?.timeoutMs ?? 10_000) / 1000}
          />
        </Field>
        <Field
          label={tm('failureThreshold')}
          hint={tm('failureThresholdHint')}
          required
          error={fields.get('failureThreshold')}
        >
          <Input
            name="failureThreshold"
            type="number"
            required
            min={1}
            max={20}
            defaultValue={monitor?.failureThreshold ?? 3}
          />
        </Field>
        <Field
          label={tm('recoveryThreshold')}
          hint={tm('recoveryThresholdHint')}
          required
          error={fields.get('recoveryThreshold')}
        >
          <Input
            name="recoveryThreshold"
            type="number"
            required
            min={1}
            max={20}
            defaultValue={monitor?.recoveryThreshold ?? 2}
          />
        </Field>
      </div>

      <fieldset className="grid gap-4 rounded-md border border-[var(--border)] p-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium">{tm('automation')}</legend>
        <Field label={tm('component')} error={fields.get('componentId')}>
          <Select name="componentId" defaultValue={monitor?.componentId ?? ''}>
            <option value="">{tm('noComponent')}</option>
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tm('failureStatus')} required error={fields.get('failureStatus')}>
          <Select name="failureStatus" defaultValue={monitor?.failureStatus ?? 'major_outage'}>
            {FAILURE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tm('mode')} hint={tm('modeHint')} required error={fields.get('mode')}>
          <Select name="mode" defaultValue={monitor?.mode ?? 'auto'}>
            {AUTOMATION_MODES.map((m) => (
              <option key={m} value={m}>
                {tm(`modes.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tm('template')} hint={tm('templateHint')} error={fields.get('templateId')}>
          <Select name="templateId" defaultValue={monitor?.templateId ?? ''}>
            <option value="">{tm('noTemplate')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Checkbox
          name="publicMetrics"
          label={tm('publicMetrics')}
          defaultChecked={monitor?.publicMetrics ?? false}
        />
        <Checkbox name="enabled" label={tm('enabled')} defaultChecked={monitor?.enabled ?? true} />
      </div>

      {result ? (
        <div
          role="status"
          data-testid="check-result"
          className={cx(
            'rounded-md border px-3 py-2 text-sm',
            result.ok
              ? 'border-status-operational text-status-operational'
              : 'border-status-major_outage text-status-major_outage',
          )}
        >
          {result.ok
            ? tm('testOk', { ms: result.latencyMs ?? 0 })
            : tm('testFail', { error: result.error ?? '' })}
          {result.detail ? ` · ${result.detail}` : null}
        </div>
      ) : null}
      <p className="text-xs text-[var(--muted)]">
        <span className="text-status-major_outage">*</span> {tm('requiredLegend')}
      </p>
      <ApiErrorAlert error={error ?? test.error} fields={fields} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {t('admin.save')}
        </Button>
        <Button
          variant="secondary"
          disabled={test.pending}
          onClick={(e) => onTest(e.currentTarget.form)}
        >
          {test.pending ? tm('testing') : tm('test')}
        </Button>
        {onDone ? (
          <Button variant="secondary" onClick={onDone}>
            {t('admin.cancel')}
          </Button>
        ) : null}
        {monitor ? (
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              if (!window.confirm(tm('confirmDelete'))) return;
              const ok = await run(
                () =>
                  api(`/pages/${pageId}/monitors/${monitor.id}`, { method: 'DELETE' }).then(
                    () => true,
                  ),
                { refresh: false },
              );
              if (ok) router.push(`/admin/pages/${pageId}/monitors`);
            }}
          >
            {t('admin.delete')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Últimas checagens do monitor. */
export function RecentChecks({
  items,
}: {
  items: { checkedAt: string; ok: boolean; latencyMs: number | null; error: string | null }[];
}) {
  const t = useTranslations('admin.monitors');
  if (items.length === 0) return <EmptyState>{t('noChecks')}</EmptyState>;
  return (
    <ul className="flex max-h-96 flex-col divide-y divide-[var(--border)] overflow-y-auto text-sm">
      {items.map((r) => (
        <li key={r.checkedAt} className="flex items-center justify-between gap-2 py-1.5">
          <span className="flex items-center gap-2">
            <span
              className={cx(
                'size-2 rounded-full',
                r.ok ? 'bg-status-operational' : 'bg-status-major_outage',
              )}
            />
            <LocalTime value={r.checkedAt} />
          </span>
          <span className={r.ok ? 'text-[var(--muted)]' : 'text-status-major_outage'}>
            {r.ok ? `${r.latencyMs} ms` : r.error}
          </span>
        </li>
      ))}
    </ul>
  );
}
