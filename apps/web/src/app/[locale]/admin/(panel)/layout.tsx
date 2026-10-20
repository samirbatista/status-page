import { isLocale } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { type ReactNode } from 'react';
import { LogoutButton } from '@/components/admin/logout-button';
import { NavLink } from '@/components/admin/nav-link';
import { LanguageSwitcher } from '@/components/language-switcher';
import { getMe } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: t('title'), robots: { index: false } };
}

export default async function PanelLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const me = await getMe(locale);
  const t = await getTranslations('admin.nav');
  const isAdminSomewhere = me.isOwner || me.pages.some((p) => p.role === 'admin');
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="flex flex-col gap-4 border-b border-[var(--border)] bg-[var(--surface)] p-4 md:w-64 md:border-r md:border-b-0">
          <div>
            <p className="font-semibold">{t('brand')}</p>
            <p className="truncate text-xs text-[var(--muted)]">{me.email}</p>
          </div>
          <nav className="flex flex-col gap-1">
            <p className="px-3 text-xs font-medium uppercase text-[var(--muted)]">{t('pages')}</p>
            {me.pages.map((page) => (
              <NavLink key={page.id} href={`/admin/pages/${page.id}`}>
                {page.name}
              </NavLink>
            ))}
            {me.isOwner ? <NavLink href="/admin/pages/new">+ {t('newPage')}</NavLink> : null}
          </nav>
          <nav className="flex flex-col gap-1">
            {me.isOwner ? <NavLink href="/admin/users">{t('users')}</NavLink> : null}
            {me.isOwner ? <NavLink href="/admin/settings/auth">{t('auth')}</NavLink> : null}
            {isAdminSomewhere ? <NavLink href="/admin/audit">{t('audit')}</NavLink> : null}
            <NavLink href="/admin/profile">{t('profile')}</NavLink>
            <LogoutButton />
          </nav>
          <div className="mt-auto">
            <LanguageSwitcher />
          </div>
        </aside>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </NextIntlClientProvider>
  );
}
