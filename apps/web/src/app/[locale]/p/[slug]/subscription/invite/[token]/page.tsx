import { isLocale } from '@status-page/shared';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { AcceptInvite } from '@/components/public/subscribe';
import { ThemedShell } from '@/components/public/themed-shell';
import { publicApi } from '@/lib/server-api';
import { type PublicSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Convite de importação: a pessoa confirma que quer receber as notificações. */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; token: string }>;
}) {
  const { locale, slug, token } = await params;
  if (!isLocale(locale) || !/^[\w-]{20,100}$/.test(token)) notFound();
  setRequestLocale(locale);
  const summary = await publicApi<PublicSummary>(`/public/pages/${encodeURIComponent(slug)}`, {
    locale,
    returnTo: `/p/${slug}`,
  });
  const t = await getTranslations('subscribe');
  const { subscribe, errors } = await getMessages();
  return (
    <ThemedShell page={summary.page}>
      <section className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h1 className="text-xl font-semibold">{t('inviteTitle', { page: summary.page.name })}</h1>
        <NextIntlClientProvider messages={{ subscribe, errors }}>
          <AcceptInvite token={token} slug={slug} />
        </NextIntlClientProvider>
      </section>
    </ThemedShell>
  );
}
