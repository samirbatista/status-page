'use client';

import { API_TOKEN_ROLES } from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client-api';
import { type ApiToken } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import { Alert, Button, EmptyState, Field, Input, Select, Textarea } from '../ui/ui';

/** Tokens da API administrativa da página (o valor aparece uma única vez). */
export function ApiTokensManager({ pageId, tokens }: { pageId: string; tokens: ApiToken[] }) {
  const t = useTranslations('admin.developers');
  const tr = useTranslations('admin.page.role');
  const { run, pending, error } = useAction();
  const [created, setCreated] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const days = String(data.get('expiresInDays') ?? '');
    const res = await run(() =>
      api<{ token: string }>(`/pages/${pageId}/api-tokens`, {
        method: 'POST',
        body: {
          name: data.get('name'),
          role: data.get('role'),
          expiresInDays: days ? Number(days) : null,
        },
      }),
    );
    if (res) {
      setCreated(res.token);
      form.reset();
    }
  }

  const active = tokens.filter((tk) => !tk.revokedAt);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--muted)]">{t('tokensIntro')}</p>
      {created ? (
        <div className="flex flex-col gap-2 rounded-md border border-status-operational p-3">
          <p className="text-sm font-medium">{t('tokenCreated')}</p>
          <CopyBox value={created} testId="new-token" />
        </div>
      ) : null}
      {active.length === 0 ? (
        <EmptyState>{t('noTokens')}</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {active.map((tk) => {
            const expired = tk.expiresAt && new Date(tk.expiresAt) < new Date();
            return (
              <li key={tk.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">
                    {tk.name} <code className="text-xs text-[var(--muted)]">{tk.prefix}…</code>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {tr(tk.role)} · {tk.createdBy.name} ·{' '}
                    {tk.expiresAt ? (
                      <>
                        {expired ? t('expired') : t('expires')} <LocalTime value={tk.expiresAt} />
                      </>
                    ) : (
                      t('noExpiry')
                    )}{' '}
                    ·{' '}
                    {tk.lastUsedAt ? (
                      <>
                        {t('lastUsed')} <LocalTime value={tk.lastUsedAt} />
                      </>
                    ) : (
                      t('neverUsed')
                    )}
                  </p>
                </div>
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={async () => {
                    if (!window.confirm(t('confirmRevoke'))) return;
                    await run(() =>
                      api(`/pages/${pageId}/api-tokens/${tk.id}`, { method: 'DELETE' }),
                    );
                  }}
                >
                  {t('revoke')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={onSubmit} className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <Field label={t('tokenName')}>
          <Input name="name" required maxLength={120} placeholder="CI/CD" />
        </Field>
        <Field label={t('tokenRole')}>
          <Select name="role" defaultValue="operator">
            {API_TOKEN_ROLES.map((r) => (
              <option key={r} value={r}>
                {tr(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('tokenExpires')}>
          <Select name="expiresInDays" defaultValue="90">
            <option value="30">{t('days', { count: 30 })}</option>
            <option value="90">{t('days', { count: 90 })}</option>
            <option value="365">{t('days', { count: 365 })}</option>
            <option value="">{t('noExpiry')}</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {t('createToken')}
        </Button>
      </form>
      <ApiErrorAlert error={error} />
    </div>
  );
}

function CopyBox({ value, testId, rows }: { value: string; testId?: string; rows?: number }) {
  const t = useTranslations('admin.developers');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      {rows ? (
        <Textarea
          readOnly
          value={value}
          rows={rows}
          className="min-h-0 font-mono text-xs"
          data-testid={testId}
          onFocus={(e) => e.target.select()}
        />
      ) : (
        <Input
          readOnly
          value={value}
          className="font-mono text-xs"
          data-testid={testId}
          onFocus={(e) => e.target.select()}
        />
      )}
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
  );
}

/** Selo, widget, iframe, JSON e feeds da página, prontos para copiar. */
export function EmbedSnippets({
  pageId,
  slug,
  isPublic,
}: {
  pageId: string;
  slug: string;
  isPublic: boolean;
}) {
  const t = useTranslations('admin.developers');
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const api = `${origin}/api/public/pages/${slug}`;
  const pageUrl = `${origin}/p/${slug}`;

  return (
    <div className="flex flex-col gap-4">
      {!isPublic ? <Alert tone="info">{t('privateHint')}</Alert> : null}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t('badge')}</p>
        <img src={`/api/public/pages/${slug}/badge.svg`} alt="status" className="self-start" />
        <CopyBox value={`[![Status](${api}/badge.svg)](${pageUrl})`} />
        <CopyBox value={`<a href="${pageUrl}"><img src="${api}/badge.svg" alt="Status"></a>`} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t('widget')}</p>
        <p className="text-xs text-[var(--muted)]">{t('widgetHint')}</p>
        <CopyBox value={`<script src="${api}/widget.js" data-lang="pt-BR" async></script>`} />
        <CopyBox
          value={`<iframe src="${pageUrl}/embed" title="Status" style="border:0;width:100%;height:240px"></iframe>`}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t('feeds')}</p>
        <CopyBox value={`${api}/feed.atom`} />
        <CopyBox value={`${api}/feed.rss`} />
        <CopyBox value={`${api}/status.json`} />
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <a href="/api/docs" target="_blank" rel="noopener" className="text-brand hover:underline">
          {t('apiDocs')} ↗
        </a>
        <a
          href={`/api/pages/${pageId}/export/history`}
          className="text-brand hover:underline"
          download
        >
          {t('exportHistory')}
        </a>
      </div>
    </div>
  );
}
