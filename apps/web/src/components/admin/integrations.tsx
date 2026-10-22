'use client';

import {
  AUTOMATION_MODES,
  type ComponentStatus,
  FAILURE_STATUSES,
  INBOUND_KINDS,
} from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import {
  type GenericMapping,
  type IncidentTemplate,
  type InboundKind,
  type InboundRule,
  type InboundSource,
} from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import { Alert, Button, Card, Checkbox, EmptyState, Field, Input, Select } from '../ui/ui';

type Option = { id: string; name: string };

const DEFAULT_MAPPING: GenericMapping = {
  itemsPath: '',
  keyPath: 'id',
  namePath: 'name',
  statusPath: 'status',
  firingValues: ['firing', 'down', 'problem', '1'],
  labelsPath: 'labels',
  summaryPath: 'message',
};

export function IntegrationsManager({
  pageId,
  sources,
  components,
  templates,
}: {
  pageId: string;
  sources: InboundSource[];
  components: Option[];
  templates: IncidentTemplate[];
}) {
  const t = useTranslations('admin.integrations');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('heading')}
        actions={
          <Button variant="secondary" onClick={() => setCreating(true)}>
            + {t('new')}
          </Button>
        }
      >
        <p className="mb-3 text-sm text-[var(--muted)]">{t('intro')}</p>
        {sources.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {s.name}{' '}
                      {!s.enabled ? (
                        <span className="text-xs text-[var(--muted)]">({t('disabled')})</span>
                      ) : null}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {t(`kind.${s.kind}`)} · {t(`modes.${s.mode}`)} ·{' '}
                      {t('rulesCount', { count: s.rules.length })} ·{' '}
                      {s.lastReceivedAt ? (
                        <>
                          {t('lastReceived')} <LocalTime value={s.lastReceivedAt} />
                        </>
                      ) : (
                        t('neverReceived')
                      )}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setOpen(open === s.id ? null : s.id)}
                    aria-expanded={open === s.id}
                  >
                    {open === s.id ? t('close') : t('configure')}
                  </Button>
                </div>
                {open === s.id ? (
                  <SourceDetail
                    pageId={pageId}
                    source={s}
                    components={components}
                    templates={templates}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating ? (
        <Card title={t('new')}>
          <SourceForm
            pageId={pageId}
            source={null}
            templates={templates}
            onDone={(created) => {
              setCreating(false);
              if (created) setOpen(created.id);
            }}
          />
        </Card>
      ) : null}
    </div>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const t = useTranslations('admin.integrations');
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          className="font-mono text-xs"
          onFocus={(e) => e.target.select()}
        />
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard?.writeText(value).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
    </Field>
  );
}

function SourceDetail({
  pageId,
  source,
  components,
  templates,
}: {
  pageId: string;
  source: InboundSource;
  components: Option[];
  templates: IncidentTemplate[];
}) {
  const t = useTranslations('admin.integrations');
  const { run, pending, error } = useAction();
  const names = new Map(components.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-4 rounded-md border border-[var(--border)] p-4">
      <CopyField value={source.url} label={t('url')} />
      <Alert tone="info">{t(`setup.${source.kind}`)}</Alert>
      {source.hasHmac ? <p className="text-sm text-[var(--muted)]">{t('hmacOn')}</p> : null}

      <RulesEditor pageId={pageId} source={source} components={components} />

      {source.lastResult ? (
        <div className="text-sm">
          <p className="font-medium">{t('lastResult')}</p>
          <p className="text-[var(--muted)]">
            {t('lastResultSummary', {
              alerts: source.lastResult.alerts,
              matched: source.lastResult.matched.length,
            })}
          </p>
          <ul className="list-inside list-disc">
            {source.lastResult.matched.map((m, i) => (
              <li key={i}>
                {m.name} → {names.get(m.componentId) ?? '?'} ·{' '}
                {m.firing ? t('firing') : t('resolved')} · {t(`outcome.${m.outcome as 'noop'}`)}
              </li>
            ))}
          </ul>
          {source.lastResult.unmatched.length > 0 ? (
            <p className="text-[var(--muted)]">
              {t('unmatched')}: {source.lastResult.unmatched.join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}

      <details>
        <summary className="cursor-pointer text-sm font-medium">{t('settings')}</summary>
        <div className="pt-3">
          <SourceForm pageId={pageId} source={source} templates={templates} />
        </div>
      </details>

      <ApiErrorAlert error={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={async () => {
            if (!window.confirm(t('confirmRotate'))) return;
            await run(() =>
              api(`/pages/${pageId}/inbound-sources/${source.id}/rotate-token`, { method: 'POST' }),
            );
          }}
        >
          {t('rotate')}
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={async () => {
            if (!window.confirm(t('confirmDelete'))) return;
            await run(() =>
              api(`/pages/${pageId}/inbound-sources/${source.id}`, { method: 'DELETE' }),
            );
          }}
        >
          {t('delete')}
        </Button>
      </div>
    </div>
  );
}

function SourceForm({
  pageId,
  source,
  templates,
  onDone,
}: {
  pageId: string;
  source: InboundSource | null;
  templates: IncidentTemplate[];
  onDone?: (created?: InboundSource) => void;
}) {
  const t = useTranslations('admin.integrations');
  const ta = useTranslations('admin');
  const { run, pending, error } = useAction();
  const [kind, setKind] = useState<InboundKind>(source?.kind ?? 'alertmanager');
  const mapping = source?.mapping ?? DEFAULT_MAPPING;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (k: string) => String(data.get(k) ?? '');
    const hmac = get('hmacSecret');
    const body: Record<string, unknown> = {
      name: get('name'),
      mode: get('mode'),
      templateId: get('templateId') || null,
      enabled: source ? data.get('enabled') === 'on' : true,
      // Em branco mantém o segredo atual; a caixa "remover" desliga a verificação.
      hmacSecret: data.get('removeHmac') === 'on' ? null : hmac || undefined,
    };
    if (kind === 'generic') {
      body.mapping = {
        itemsPath: get('itemsPath'),
        keyPath: get('keyPath'),
        namePath: get('namePath'),
        statusPath: get('statusPath'),
        firingValues: get('firingValues')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        labelsPath: get('labelsPath'),
        summaryPath: get('summaryPath'),
      };
    }
    const saved = await run(() =>
      source
        ? api<InboundSource>(`/pages/${pageId}/inbound-sources/${source.id}`, {
            method: 'PUT',
            body,
          })
        : api<InboundSource>(`/pages/${pageId}/inbound-sources`, {
            method: 'POST',
            body: { ...body, kind },
          }),
    );
    if (saved) onDone?.(saved);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('name')}>
          <Input name="name" defaultValue={source?.name} required maxLength={120} />
        </Field>
        <Field label={t('kindLabel')}>
          <Select
            name="kind"
            value={kind}
            disabled={Boolean(source)}
            onChange={(e) => setKind(e.target.value as InboundKind)}
          >
            {INBOUND_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('mode')} hint={t('modeHint')}>
          <Select name="mode" defaultValue={source?.mode ?? 'suggest'}>
            {AUTOMATION_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`modes.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('template')} hint={t('templateHint')}>
          <Select name="templateId" defaultValue={source?.templateId ?? ''}>
            <option value="">{t('noTemplate')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('hmacSecret')}
          hint={source?.hasHmac ? t('hmacKeep') : t('hmacHint')}
          className="sm:col-span-2"
        >
          <Input name="hmacSecret" type="password" autoComplete="new-password" maxLength={256} />
        </Field>
      </div>
      {source?.hasHmac ? <Checkbox name="removeHmac" label={t('removeHmac')} /> : null}
      {kind === 'generic' ? (
        <fieldset className="grid gap-4 rounded-md border border-[var(--border)] p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">{t('mapping')}</legend>
          <p className="text-xs text-[var(--muted)] sm:col-span-3">{t('mappingHint')}</p>
          <Field label={t('itemsPath')}>
            <Input name="itemsPath" defaultValue={mapping.itemsPath} placeholder="alerts" />
          </Field>
          <Field label={t('keyPath')}>
            <Input name="keyPath" defaultValue={mapping.keyPath} />
          </Field>
          <Field label={t('namePath')}>
            <Input name="namePath" defaultValue={mapping.namePath} />
          </Field>
          <Field label={t('statusPath')}>
            <Input name="statusPath" defaultValue={mapping.statusPath} />
          </Field>
          <Field label={t('firingValues')}>
            <Input name="firingValues" defaultValue={mapping.firingValues.join(', ')} />
          </Field>
          <Field label={t('labelsPath')}>
            <Input name="labelsPath" defaultValue={mapping.labelsPath} />
          </Field>
          <Field label={t('summaryPath')}>
            <Input name="summaryPath" defaultValue={mapping.summaryPath} />
          </Field>
        </fieldset>
      ) : null}
      {source ? (
        <Checkbox name="enabled" label={t('enabled')} defaultChecked={source.enabled} />
      ) : null}
      <ApiErrorAlert error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {ta('save')}
        </Button>
        {onDone && !source ? (
          <Button variant="secondary" onClick={() => onDone()}>
            {ta('cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function RulesEditor({
  pageId,
  source,
  components,
}: {
  pageId: string;
  source: InboundSource;
  components: Option[];
}) {
  const t = useTranslations('admin.integrations');
  const ts = useTranslations('status');
  const ta = useTranslations('admin');
  const { run, pending, error } = useAction();
  const [rules, setRules] = useState<InboundRule[]>(source.rules);
  const [saved, setSaved] = useState(false);

  const update = (i: number, patch: Partial<InboundRule>) => {
    setSaved(false);
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const move = (i: number, delta: number) => {
    const next = [...rules];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item!);
    setRules(next);
    setSaved(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-medium">{t('rules')}</p>
        <p className="text-sm text-[var(--muted)]">{t('rulesHint')}</p>
      </div>
      {rules.length === 0 ? <p className="text-sm text-[var(--muted)]">{t('noRules')}</p> : null}
      {rules.map((rule, i) => (
        <div
          key={i}
          className="grid items-end gap-2 sm:grid-cols-[9rem_1fr_1fr_1fr_auto]"
          data-testid="rule"
        >
          <Field label={t('matchField')}>
            <Input
              value={rule.matchField}
              onChange={(e) => update(i, { matchField: e.target.value })}
              placeholder="name"
              list="match-fields"
            />
          </Field>
          <Field label={t('pattern')}>
            <Input
              value={rule.pattern}
              onChange={(e) => update(i, { pattern: e.target.value })}
              placeholder="api-*"
            />
          </Field>
          <Field label={t('component')}>
            <Select
              value={rule.componentId}
              onChange={(e) => update(i, { componentId: e.target.value })}
            >
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('status')}>
            <Select
              value={rule.status}
              onChange={(e) => update(i, { status: e.target.value as ComponentStatus })}
            >
              {FAILURE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ts(s)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-1">
            <Button variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="↑">
              ↑
            </Button>
            <Button
              variant="ghost"
              disabled={i === rules.length - 1}
              onClick={() => move(i, 1)}
              aria-label="↓"
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRules(rules.filter((_, idx) => idx !== i));
                setSaved(false);
              }}
              aria-label={ta('delete')}
            >
              ✕
            </Button>
          </div>
        </div>
      ))}
      <datalist id="match-fields">
        <option value="name" />
        <option value="label:service" />
        <option value="label:host" />
        <option value="label:severity" />
      </datalist>
      <ApiErrorAlert error={error} />
      {saved ? <p className="text-sm text-status-operational">{t('rulesSaved')}</p> : null}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={components.length === 0}
          onClick={() =>
            setRules([
              ...rules,
              {
                matchField: 'name',
                pattern: '*',
                componentId: components[0]!.id,
                status: 'major_outage',
              },
            ])
          }
        >
          + {t('addRule')}
        </Button>
        <Button
          disabled={pending}
          onClick={async () => {
            const ok = await run(() =>
              api(`/pages/${pageId}/inbound-sources/${source.id}/rules`, {
                method: 'PUT',
                body: {
                  rules: rules.map(({ matchField, pattern, componentId, status }) => ({
                    matchField,
                    pattern,
                    componentId,
                    status,
                  })),
                },
              }).then(() => true),
            );
            if (ok) setSaved(true);
          }}
        >
          {t('saveRules')}
        </Button>
      </div>
    </div>
  );
}
