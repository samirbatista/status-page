import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import {
  type NotifySettings,
  SmtpForm,
  TelegramForm,
  WhatsappForm,
} from '@/components/admin/notify-settings';
import { getMe } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';

/** Provedores globais de notificação (Dono). */
export default async function NotifySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const me = await getMe(locale);
  if (!me.isOwner) notFound();
  const settings = await adminApi<NotifySettings>('/notifications/settings', locale);
  const t = await getTranslations('admin.notifySettings');
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('heading')}</h1>
        <p className="text-sm text-[var(--muted)]">{t('intro')}</p>
      </div>
      <SmtpForm settings={settings.smtp} />
      <TelegramForm settings={settings.telegram} />
      <WhatsappForm settings={settings.whatsapp} />
    </div>
  );
}
