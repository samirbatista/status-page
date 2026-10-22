import { isLocale, METRIC_RANGES } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MetricsChart } from '@/components/metrics-chart';
import { ThemedShell } from '@/components/public/themed-shell';
import { cx } from '@/components/ui/ui';
import { Link } from '@/i18n/navigation';
import { pageMetadata } from '@/lib/page-metadata';
import { publicApi } from '@/lib/server-api';
import { type MetricRange, type PublicMetrics, type PublicPage } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string }>;
type SearchParams = Promise<{ range?: string }>;

async function load(params: Params, searchParams: SearchParams) {
  const { locale, slug } = await params;
  const raw = (await searchParams).range;
  const range: MetricRange = (METRIC_RANGES as readonly string[]).includes(raw ?? '')
    ? (raw as MetricRange)
    : 'day';
  const data = await publicApi<PublicMetrics & { page: PublicPage }>(
    `/public/pages/${encodeURIComponent(slug)}/metrics?range=${range}`,
    { locale, returnTo: `/p/${slug}/metrics` },
  );
  return { ...data, range };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { page } = await load(params, searchParams);
  const t = await getTranslations('metrics');
  return pageMetadata(page, t('heading'));
}

export default async function MetricsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const { page, monitors, range } = await load(params, searchParams);
  const t = await getTranslations('metrics');

  return (
    <ThemedShell page={page}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('heading')}</h1>
        <nav className="flex gap-1 text-sm" aria-label={t('rangeLabel')}>
          {METRIC_RANGES.map((r) => (
            <Link
              key={r}
              href={`/p/${slug}/metrics?range=${r}`}
              aria-current={r === range ? 'page' : undefined}
              className={cx(
                'rounded px-3 py-1',
                r === range ? 'bg-brand text-white' : 'hover:bg-[var(--surface)]',
              )}
            >
              {t(`range.${r}`)}
            </Link>
          ))}
        </nav>
      </div>
      {monitors.length === 0 ? (
        <p className="text-[var(--muted)]">{t('empty')}</p>
      ) : (
        monitors.map((m) => (
          <section
            key={m.id}
            className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <h2 className="font-semibold">{m.component?.name ?? m.name}</h2>
            {m.component && m.component.name !== m.name ? (
              <p className="-mt-2 text-sm text-[var(--muted)]">{m.name}</p>
            ) : null}
            <MetricsChart series={m} fallbackTimeZone={page.timezone} />
          </section>
        ))
      )}
      <Link href={`/p/${slug}`} className="text-sm text-[var(--link)] hover:underline">
        ← {t('back')}
      </Link>
    </ThemedShell>
  );
}
