'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ClientApiError } from '@/lib/client-api';
import { type ImportReport } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Alert, Button, Card, Checkbox, Field, Input, Select } from '../ui/ui';

const HEADERS = { 'X-Requested-With': 'status-page' };

async function failure(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  throw new ClientApiError(res.status, String(body?.message ?? 'unknown'), body);
}

/** Exportar e importar a configuração da instalação (Dono). */
export function ConfigTransfer({ pages }: { pages: { id: string; name: string }[] }) {
  const t = useTranslations('admin.transfer');
  const exporting = useAction();
  const importing = useAction();
  const [selected, setSelected] = useState<string[]>(pages.map((p) => p.id));
  const [report, setReport] = useState<ImportReport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [importPassword, setImportPassword] = useState('');

  async function onExport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await exporting.run(
      async () => {
        const res = await fetch('/api/admin/config/export', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { ...HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageIds: selected.length === pages.length ? [] : selected,
            password: data.get('password') || null,
            includeLdap: data.get('includeLdap') === 'on',
          }),
        });
        if (!res.ok) await failure(res);
        const name =
          /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
          'status-page-config.json';
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      },
      { refresh: false },
    );
  }

  async function runImport(dryRun: boolean) {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    body.append('mode', mode);
    body.append('dryRun', String(dryRun));
    if (importPassword) body.append('password', importPassword);
    const result = await importing.run(
      async () => {
        const res = await fetch('/api/admin/config/import', {
          method: 'POST',
          credentials: 'same-origin',
          headers: HEADERS,
          body,
        });
        if (!res.ok) await failure(res);
        return (await res.json()) as ImportReport;
      },
      { refresh: !dryRun },
    );
    if (result) setReport(result);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card title={t('exportHeading')}>
        <form onSubmit={onExport} className="flex flex-col gap-4">
          <p className="text-sm text-[var(--muted)]">{t('exportIntro')}</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('pages')}</legend>
            {pages.map((p) => (
              <Checkbox
                key={p.id}
                label={p.name}
                checked={selected.includes(p.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id),
                  )
                }
              />
            ))}
          </fieldset>
          <Checkbox name="includeLdap" label={t('includeLdap')} defaultChecked />
          <Field label={t('password')} hint={t('passwordHint')}>
            <Input name="password" type="password" minLength={12} autoComplete="new-password" />
          </Field>
          <ApiErrorAlert error={exporting.error} />
          <Button
            type="submit"
            disabled={exporting.pending || selected.length === 0}
            className="self-start"
          >
            {t('export')}
          </Button>
        </form>
      </Card>

      <Card title={t('importHeading')}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--muted)]">{t('importIntro')}</p>
          <Field label={t('file')}>
            <Input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReport(null);
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('mode')} hint={t(`modeHint.${mode}`)}>
              <Select
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as 'merge' | 'replace');
                  setReport(null);
                }}
              >
                <option value="merge">{t('modes.merge')}</option>
                <option value="replace">{t('modes.replace')}</option>
              </Select>
            </Field>
            <Field label={t('importPassword')} hint={t('importPasswordHint')}>
              <Input
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>
          <ApiErrorAlert error={importing.error} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!file || importing.pending}
              onClick={() => runImport(true)}
            >
              {t('preview')}
            </Button>
            {report?.dryRun ? (
              <Button
                variant={mode === 'replace' ? 'danger' : 'primary'}
                disabled={importing.pending}
                onClick={() => {
                  if (mode === 'replace' && !window.confirm(t('confirmReplace'))) return;
                  void runImport(false);
                }}
              >
                {t('apply')}
              </Button>
            ) : null}
          </div>
          {report ? <ReportView report={report} /> : null}
        </div>
      </Card>
    </div>
  );
}

function ReportView({ report }: { report: ImportReport }) {
  const t = useTranslations('admin.transfer');
  return (
    <div className="flex flex-col gap-3" data-testid="import-report">
      <Alert tone="info">
        {report.dryRun ? t('previewDone') : t('applied')}
        {report.withSecrets ? '' : ` ${t('noSecrets')}`}
      </Alert>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]">
            <tr>
              <th className="py-1 pr-3">{t('page')}</th>
              <th className="py-1 pr-3">{t('created')}</th>
              <th className="py-1 pr-3">{t('updated')}</th>
              <th className="py-1">{t('removed')}</th>
            </tr>
          </thead>
          <tbody>
            {report.pages.map((p) => {
              const sum = (k: 'created' | 'updated' | 'deleted') =>
                Object.values(p.changes).reduce((acc, c) => acc + c[k], 0);
              return (
                <tr key={p.slug} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-3">
                    {p.slug}{' '}
                    <span className="text-xs text-[var(--muted)]">({t(`action.${p.action}`)})</span>
                  </td>
                  <td className="py-1 pr-3">{sum('created')}</td>
                  <td className="py-1 pr-3">{sum('updated')}</td>
                  <td className="py-1">{p.removed.length ? p.removed.join(', ') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {report.ldapProviders.names.length ? (
        <p className="text-sm">
          {t('ldap')}: {report.ldapProviders.names.join(', ')}
        </p>
      ) : null}
      {report.warnings.length ? (
        <div className="text-sm">
          <p className="font-medium">{t('warnings')}</p>
          <ul className="list-inside list-disc text-[var(--muted)]">
            {report.warnings.map((w, i) => (
              <li key={i}>
                {w.scope}:{' '}
                {t.has(`warning.${w.message}` as 'warning.secrets_not_imported')
                  ? t(`warning.${w.message}` as 'warning.secrets_not_imported')
                  : w.message}
                {w.detail ? ` (${w.detail})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
