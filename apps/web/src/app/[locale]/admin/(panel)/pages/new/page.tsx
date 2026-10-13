import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PageSettingsForm } from '@/components/admin/page-settings-form';
import { Card } from '@/components/ui/ui';
import { getMe } from '@/lib/admin';

export default async function NewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const me = await getMe(locale);
  if (!me.isOwner) notFound();
  const t = await getTranslations('admin.settings');
  return (
    <div className="mx-auto max-w-3xl">
      <Card title={t('newHeading')}>
        <PageSettingsForm isOwner />
      </Card>
    </div>
  );
}
