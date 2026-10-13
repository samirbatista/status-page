'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ClientApiError } from '@/lib/client-api';
import { type DomainInfo } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { LocalTime } from '../local-time';
import { Alert, Button, EmptyState, Field, Input } from '../ui/ui';

/** Domínios próprios da página, com a verificação por registro DNS TXT. */
export function DomainsManager({
  pageId,
  domains,
  isOwner,
}: {
  pageId: string;
  domains: DomainInfo[];
  isOwner: boolean;
}) {
  const t = useTranslations('admin.domains');
  const tAdmin = useTranslations('admin');
  const { run, pending, error } = useAction();
  const [failed, setFailed] = useState<string | null>(null);

  async function verify(domain: DomainInfo) {
    setFailed(null);
    try {
      await api(`/pages/${pageId}/domains/${domain.id}/verify`, { method: 'POST' });
      await run(async () => undefined);
    } catch (e) {
      if (e instanceof ClientApiError && e.code === 'verification_failed') setFailed(domain.id);
      else await run(() => Promise.reject(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--muted)]">{t('intro')}</p>
      {domains.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {domains.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono font-medium">{d.hostname}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {d.verifiedAt ? (
                      <span className="text-status-operational">
                        {t('verified')} · <LocalTime value={d.verifiedAt} />
                      </span>
                    ) : (
                      t('pending')
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!d.verifiedAt ? (
                    <Button variant="secondary" disabled={pending} onClick={() => void verify(d)}>
                      {t('verify')}
                    </Button>
                  ) : null}
                  {!d.verifiedAt && isOwner ? (
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(t('confirmForce'))) {
                          void run(() =>
                            api(`/pages/${pageId}/domains/${d.id}/force-verify`, {
                              method: 'POST',
                            }),
                          );
                        }
                      }}
                    >
                      {t('forceVerify')}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="text-status-major_outage"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(t('confirmRemove', { hostname: d.hostname }))) {
                        void run(() =>
                          api(`/pages/${pageId}/domains/${d.id}`, { method: 'DELETE' }),
                        );
                      }
                    }}
                  >
                    {tAdmin('delete')}
                  </Button>
                </div>
              </div>
              {!d.verifiedAt ? (
                <div className="rounded-md bg-[var(--background)] p-3 text-xs">
                  <p className="mb-2">{t('instructions')}</p>
                  <dl className="grid grid-cols-[5rem_1fr] gap-1 font-mono break-all">
                    <dt className="text-[var(--muted)]">{t('type')}</dt>
                    <dd>{d.record.type}</dd>
                    <dt className="text-[var(--muted)]">{t('name')}</dt>
                    <dd>{d.record.name}</dd>
                    <dt className="text-[var(--muted)]">{t('value')}</dt>
                    <dd>{d.record.value}</dd>
                  </dl>
                  <p className="mt-2 text-[var(--muted)]">{t('dnsHint')}</p>
                </div>
              ) : null}
              {failed === d.id ? <Alert>{t('verificationFailed')}</Alert> : null}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const hostname = String(new FormData(formElement).get('hostname'));
          const ok = await run(() =>
            api(`/pages/${pageId}/domains`, { method: 'POST', body: { hostname } }).then(
              () => true,
            ),
          );
          if (ok) formElement.reset();
        }}
      >
        <Field label={t('hostname')} className="min-w-60 flex-1">
          <Input name="hostname" required placeholder="status.empresa.com.br" maxLength={253} />
        </Field>
        <Button type="submit" disabled={pending}>
          {t('add')}
        </Button>
      </form>
      <p className="text-xs text-[var(--muted)]">{t('tlsHint')}</p>
      <ApiErrorAlert error={error} />
    </div>
  );
}
