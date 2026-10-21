import { isLocale } from '@status-page/shared';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { ManageSubscription, type ManagedSubscription } from '@/components/public/subscribe';
import { ThemedShell } from '@/components/public/themed-shell';
import { ApiError, publicApi, serverApi } from '@/lib/server-api';
import { type PublicSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Link de gerenciamento/cancelamento enviado em toda mensagem. */
export default async function ManageSubscriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string; token: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { locale, slug, token } = await params;
  if (!isLocale(locale) || !/^[\w-]{20,100}$/.test(token)) notFound();
  setRequestLocale(locale);
  const summary = await publicApi<PublicSummary>(`/public/pages/${encodeURIComponent(slug)}`, {
    locale,
    returnTo: `/p/${slug}`,
  });
  let subscription: ManagedSubscription;
  try {
    subscription = await serverApi<ManagedSubscription>(`/public/subscriptions/${token}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  if (subscription.page.slug !== slug) notFound();
  const t = await getTranslations('subscribe');
  const { subscribe, errors } = await getMessages();
  return (
    <ThemedShell page={summary.page}>
      <section className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h1 className="text-xl font-semibold">{t('manageTitle')}</h1>
        <NextIntlClientProvider messages={{ subscribe, errors }}>
          <ManageSubscription
            token={token}
            initial={subscription}
            askUnsubscribe={(await searchParams).action === 'unsubscribe'}
          />
        </NextIntlClientProvider>
      </section>
    </ThemedShell>
  );
}
