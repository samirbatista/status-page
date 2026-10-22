import { isLocale, themeToCss } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmbedHeight } from '@/components/public/embed-height';
import { ComponentStatusBadge, STATUS_BG } from '@/components/status-badge';
import { cx } from '@/components/ui/ui';
import { publicApi } from '@/lib/server-api';
import { type PublicSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug, robots: { index: false, follow: false } };
}

/**
 * Mini painel para incorporar em outros sites (widget.js ou iframe): status
 * geral, componentes e incidentes ativos. Os links abrem a página completa.
 */
export default async function EmbedPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const summary = await publicApi<PublicSummary>(`/public/pages/${encodeURIComponent(slug)}`, {
    locale,
    returnTo: `/p/${slug}`,
  });
  const t = await getTranslations();
  const { page } = summary;
  // Só páginas públicas podem ser incorporadas em outros sites.
  if (page.visibility !== 'public') notFound();
  const href = `/${locale}/p/${page.slug}`;

  return (
    <div className="sp-theme bg-[var(--background)] text-[var(--foreground)]">
      <style dangerouslySetInnerHTML={{ __html: themeToCss(page.theme) }} />
      <EmbedHeight>
        <div className="flex flex-col gap-2 p-3 text-sm">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-status={summary.status}
            className={cx(
              'flex items-center justify-between gap-2 rounded-md px-3 py-2 font-medium text-white',
              STATUS_BG[summary.status],
            )}
          >
            <span>{page.name}</span>
            <span>{t(`overall.${summary.status}`)}</span>
          </a>
          {summary.activeIncidents.map((i) => (
            <a
              key={i.id}
              href={`${href}/incidents/${i.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 hover:underline"
            >
              {i.title}
            </a>
          ))}
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--surface)]">
            {summary.components.slice(0, 20).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span>{c.name}</span>
                <ComponentStatusBadge status={c.status} />
              </li>
            ))}
          </ul>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="self-end text-xs text-[var(--link)] hover:underline"
          >
            {t('distribution.viewPage')} ↗
          </a>
        </div>
      </EmbedHeight>
    </div>
  );
}
