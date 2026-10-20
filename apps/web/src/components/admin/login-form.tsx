'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { safeNextPath } from '@/lib/next-path';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Button, Field, Input } from '../ui/ui';

export function LoginForm() {
  const t = useTranslations('admin.login');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { run, pending, error } = useAction();
  // Volta para a página privada que pediu o login (só caminhos locais).
  const safeNext = safeNextPath(searchParams.get('next'));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await run(
      () =>
        api<{ ok: true; mfa: 'pending' | 'enroll' | null }>('/auth/login', {
          method: 'POST',
          body: { login: form.get('login'), password: form.get('password') },
        }),
      { refresh: false },
    );
    if (!result) return;
    if (result.mfa) {
      router.replace(safeNext ? `/admin/mfa?next=${encodeURIComponent(safeNext)}` : '/admin/mfa');
    } else if (safeNext) window.location.assign(safeNext);
    else router.replace('/admin');
  }

  return (
    // method="post": se enviado antes de o JavaScript carregar, a senha não vai para a URL.
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={t('login')} hint={t('loginHint')}>
        <Input
          name="login"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />
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
