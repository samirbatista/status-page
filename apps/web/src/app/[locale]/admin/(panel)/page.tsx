import { isLocale } from '@status-page/shared';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/ui';
import { Link, redirect } from '@/i18n/navigation';
import { getMe } from '@/lib/admin';

export default async function AdminHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const me = await getMe(locale);
  const first = me.pages[0];
  if (first) redirect({ href: `/admin/pages/${first.id}`, locale });

  const t = await getTranslations('admin.home');
  return (
    <div className="mx-auto max-w-lg">
      <EmptyState>
        {me.isOwner ? (
          <>
            {t('noPagesOwner')}{' '}
            <Link href="/admin/pages/new" className="text-brand hover:underline">
              {t('createFirst')}
            </Link>
          </>
        ) : (
          t('noPagesMember')
        )}
      </EmptyState>
    </div>
  );
}
