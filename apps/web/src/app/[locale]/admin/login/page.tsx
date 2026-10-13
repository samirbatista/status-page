import { isLocale } from '@status-page/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { LoginForm } from '@/components/admin/login-form';
import { LanguageSwitcher } from '@/components/language-switcher';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.login');
  return { title: t('title'), robots: { index: false } };
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('admin.login');
  const { common, admin, errors } = await getMessages();
  return (
    <NextIntlClientProvider messages={{ common, admin, errors }}>
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <LanguageSwitcher />
      </main>
    </NextIntlClientProvider>
  );
}
