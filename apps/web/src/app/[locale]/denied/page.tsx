import { isLocale } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = { robots: { index: false } };

/** Página privada acessada sem permissão ou fora da rede liberada. */
export default async function DeniedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const reason = (await searchParams).reason === 'ip' ? 'ip' : 'role';
  const t = await getTranslations('denied');
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-[var(--muted)]">{t(reason)}</p>
      {reason === 'role' ? (
        <Link href="/admin/login" className="text-brand hover:underline">
          {t('otherAccount')}
        </Link>
      ) : null}
    </main>
  );
}
