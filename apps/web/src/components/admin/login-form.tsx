'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Button, Field, Input } from '../ui/ui';

export function LoginForm() {
  const t = useTranslations('admin.login');
  const router = useRouter();
  const { run, pending, error } = useAction();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await run(
      () =>
        api('/auth/login', {
          method: 'POST',
          body: { email: form.get('email'), password: form.get('password') },
        }),
      { refresh: false },
    );
    if (ok) router.replace('/admin');
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={t('email')}>
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label={t('password')}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <ApiErrorAlert error={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
