import { getTranslations } from 'next-intl/server';
import { type ReactNode } from 'react';
import { NavLink } from '@/components/admin/nav-link';
import { Link } from '@/i18n/navigation';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminPage } from '@/lib/types';

export default async function PageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  const me = await getMe(locale);
  const role = pageRole(me, pageId);
  const page = await adminApi<AdminPage>(`/pages/${pageId}`, locale);
  const t = await getTranslations('admin.page');
  const base = `/admin/pages/${pageId}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{page.name}</h1>
          <p className="text-sm text-[var(--muted)]">
            {t(`role.${role}`)} ·{' '}
            {page.visibility === 'public' ? (
              <Link href={`/p/${page.slug}`} className="text-brand hover:underline" target="_blank">
                {t('viewPublic')} ↗
              </Link>
            ) : (
              t('private')
            )}
          </p>
        </div>
      </header>
      <nav className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2">
        <NavLink href={base} exact>
          {t('tabs.overview')}
        </NavLink>
        <NavLink href={`${base}/incidents`}>{t('tabs.incidents')}</NavLink>
        <NavLink href={`${base}/maintenances`}>{t('tabs.maintenances')}</NavLink>
        <NavLink href={`${base}/components`}>{t('tabs.components')}</NavLink>
        <NavLink href={`${base}/templates`}>{t('tabs.templates')}</NavLink>
        {can(role, 'admin') ? <NavLink href={`${base}/team`}>{t('tabs.team')}</NavLink> : null}
        {can(role, 'admin') ? (
          <NavLink href={`${base}/settings`}>{t('tabs.settings')}</NavLink>
        ) : null}
      </nav>
      {children}
    </div>
  );
}
