import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LocalTime } from '@/components/local-time';
import { Button, Card, EmptyState, Field, Input, Select } from '@/components/ui/ui';
import { Link } from '@/i18n/navigation';
import { getMe } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AuditEntry, type Paginated } from '@/lib/types';

type Search = { pageId?: string; action?: string; entityType?: string; cursor?: string };

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale } = await params;
  const search = await searchParams;
  const me = await getMe(locale);
  // Admins só veem a auditoria das páginas que administram.
  const pages = me.isOwner ? me.pages : me.pages.filter((p) => p.role === 'admin');
  if (pages.length === 0 && !me.isOwner) notFound();
  const pageId = search.pageId || (me.isOwner ? undefined : pages[0]?.id);

  const filters = new URLSearchParams();
  if (pageId) filters.set('pageId', pageId);
  if (search.action) filters.set('action', search.action);
  if (search.entityType) filters.set('entityType', search.entityType);
  const query = new URLSearchParams(filters);
  query.set('limit', '50');
  if (search.cursor) query.set('cursor', search.cursor);

  const data = await adminApi<Paginated<AuditEntry>>(`/audit?${query}`, locale);
  const t = await getTranslations('admin.audit');
  const pageName = new Map(me.pages.map((p) => [p.id, p.name]));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <Card
        title={t('heading')}
        actions={
          <a
            href={`/api/audit/export.csv?${filters}`}
            className="text-sm text-brand hover:underline"
          >
            {t('export')}
          </a>
        }
      >
        <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
          <Field label={t('page')}>
            <Select name="pageId" defaultValue={pageId ?? ''}>
              {me.isOwner ? <option value="">{t('allPages')}</option> : null}
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('action')}>
            <Input name="action" defaultValue={search.action} placeholder="incident." />
          </Field>
          <Field label={t('entity')}>
            <Input name="entityType" defaultValue={search.entityType} placeholder="incident" />
          </Field>
          <Button type="submit" variant="secondary">
            {t('filter')}
          </Button>
        </form>
        {data.items.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr>
                  <th className="py-2 pr-4">{t('when')}</th>
                  <th className="py-2 pr-4">{t('who')}</th>
                  <th className="py-2 pr-4">{t('action')}</th>
                  <th className="py-2 pr-4">{t('page')}</th>
                  <th className="py-2 pr-4">IP</th>
                  <th className="py-2">{t('details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.items.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <LocalTime value={e.createdAt} />
                    </td>
                    <td className="py-2 pr-4">{e.actor?.email ?? t('system')}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{e.action}</td>
                    <td className="py-2 pr-4">
                      {e.pageId ? (pageName.get(e.pageId) ?? '—') : '—'}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{e.ip ?? '—'}</td>
                    <td className="py-2">
                      {e.before || e.after ? (
                        <details>
                          <summary className="cursor-pointer text-brand">{t('show')}</summary>
                          <pre className="mt-2 max-w-md overflow-x-auto rounded bg-[var(--background)] p-2 text-xs">
                            {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.nextCursor ? (
          <div className="pt-4 text-right">
            <Link
              href={`/admin/audit?${new URLSearchParams({ ...Object.fromEntries(filters), cursor: data.nextCursor })}`}
              className="text-sm text-brand hover:underline"
            >
              {t('older')} →
            </Link>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
