import { getTranslations } from 'next-intl/server';
import { type ReactNode } from 'react';
import { NavLink } from '@/components/admin/nav-link';
import { can, getMe, pageRole } from '@/lib/admin';

/** Notificações da página: entregas (Operador) e canais, assinantes e templates (Admin). */
export default async function NotificationsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  const role = pageRole(await getMe(locale), pageId);
  const t = await getTranslations('admin.notifications');
  const base = `/admin/pages/${pageId}/notifications`;
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-1 text-sm">
        <NavLink href={base} exact>
          {t('tabs.deliveries')}
        </NavLink>
        {can(role, 'admin') ? (
          <>
            <NavLink href={`${base}/channels`}>{t('tabs.channels')}</NavLink>
            <NavLink href={`${base}/subscribers`}>{t('tabs.subscribers')}</NavLink>
            <NavLink href={`${base}/templates`}>{t('tabs.templates')}</NavLink>
          </>
        ) : null}
      </nav>
      {children}
    </div>
  );
}
