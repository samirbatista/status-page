import { isLocale } from '@status-page/shared';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StatusPageView } from '@/components/public/status-page-view';
import { Link } from '@/i18n/navigation';
import { pageMetadata } from '@/lib/page-metadata';
import { ApiError, publicApi, serverApi } from '@/lib/server-api';
import { type PublicSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Favicon e título da página padrão (sem bloquear a página se ela for privada). */
export async function generateMetadata() {
  try {
    const { slug } = await serverApi<{ slug: string }>('/public/default');
    const summary = await serverApi<PublicSummary>(`/public/pages/${encodeURIComponent(slug)}`);
    return pageMetadata(summary.page);
  } catch {
    return {};
  }
}

/** Raiz do site: exibe a página definida como padrão. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  let slug: string | null = null;
  try {
    slug = (await serverApi<{ slug: string }>('/public/default')).slug;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }

  if (!slug) {
    const t = await getTranslations('home');
    return (
      <main className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">{t('emptyTitle')}</h1>
        <p className="text-[var(--muted)]">{t('emptyBody')}</p>
        <Link href="/admin" className="text-brand hover:underline">
          {t('goToAdmin')}
        </Link>
      </main>
    );
  }

  const summary = await publicApi<PublicSummary>(`/public/pages/${encodeURIComponent(slug)}`, {
    locale,
    returnTo: '/',
  });
  return <StatusPageView summary={summary} />;
}
