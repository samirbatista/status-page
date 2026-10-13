'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { Button } from '../ui/ui';

export function LogoutButton() {
  const t = useTranslations('admin.nav');
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      className="w-full justify-start"
      onClick={async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        router.replace('/admin/login');
      }}
    >
      {t('logout')}
    </Button>
  );
}
