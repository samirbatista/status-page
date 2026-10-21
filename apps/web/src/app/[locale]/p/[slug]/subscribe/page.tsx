import { isLocale } from '@status-page/shared';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { SubscribeForm, type SubscribeOptions } from '@/components/public/subscribe';
import { ThemedShell } from '@/components/public/themed-shell';
import { publicApi } from '@/lib/server-api';
import { type PublicSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SubscribePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const context = { locale, returnTo: `/p/${slug}/subscribe` };
  const [summary, options] = await Promise.all([
    publicApi<PublicSummary>(`/public/pages/${encodeURIComponent(slug)}`, context),
    publicApi<SubscribeOptions>(`/public/pages/${encodeURIComponent(slug)}/subscribe`, context),
  ]);
  const t = await getTranslations('subscribe');
  const { subscribe, errors } = await getMessages();
  return (
    <ThemedShell page={summary.page}>
      <section className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-[var(--muted)]">{t('intro', { page: summary.page.name })}</p>
        </div>
        <NextIntlClientProvider messages={{ subscribe, errors }}>
          <SubscribeForm options={options} />
        </NextIntlClientProvider>
      </section>
    </ThemedShell>
  );
}
