import { getTranslations } from 'next-intl/server';
import { ChangePasswordForm, NoLocalPassword, SessionsList } from '@/components/admin/profile';
import { Card } from '@/components/ui/ui';
import { getMe } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type SessionInfo } from '@/lib/types';

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const me = await getMe(locale);
  const sessions = await adminApi<SessionInfo[]>('/auth/sessions', locale);
  const t = await getTranslations('admin.profile');
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Card title={t('heading')}>
        <p className="font-medium">{me.name}</p>
        <p className="text-sm text-[var(--muted)]">{me.email}</p>
      </Card>
      <Card title={t('password')}>
        {me.providers.includes('local') ? <ChangePasswordForm /> : <NoLocalPassword />}
      </Card>
      <SessionsList sessions={sessions} />
    </div>
  );
}
