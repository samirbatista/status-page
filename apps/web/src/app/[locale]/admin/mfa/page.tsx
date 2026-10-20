import { isLocale } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { LogoutButton } from '@/components/admin/logout-button';
import { MfaChallenge, MfaEnrollment } from '@/components/admin/mfa';
import { LanguageSwitcher } from '@/components/language-switcher';
import { safeNextPath } from '@/lib/next-path';
import { ApiError, serverApi } from '@/lib/server-api';
import { type Me } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.mfa');
  return { title: t('title'), robots: { index: false } };
}

/** Segundo fator logo após a senha: verificação ou cadastro exigido pela política. */
export default async function MfaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const next = safeNextPath((await searchParams).next) ?? `/${locale}/admin`;

  let me: Me;
  try {
    me = await serverApi<Me>('/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect(`/${locale}/admin/login`);
    throw error;
  }
  if (me.mfa === 'ok') redirect(next);

  const t = await getTranslations('admin.mfa');
  const { common, admin, errors } = await getMessages();
  return (
    <NextIntlClientProvider messages={{ common, admin, errors }}>
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold">
            {me.mfa === 'pending' ? t('title') : t('enrollTitle')}
          </h1>
          <p className="text-sm text-[var(--muted)]">{me.email}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          {me.mfa === 'pending' ? (
            <MfaChallenge methods={me.mfaMethods} next={next} />
          ) : (
            <MfaEnrollment next={next} />
          )}
        </div>
        <div className="flex items-center justify-between">
          <LanguageSwitcher />
          <LogoutButton />
        </div>
      </main>
    </NextIntlClientProvider>
  );
}
