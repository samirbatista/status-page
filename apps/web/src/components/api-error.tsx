'use client';

import { useTranslations } from 'next-intl';
import { ClientApiError } from '@/lib/client-api';
import { Alert } from './ui/ui';

const KNOWN = new Set([
  'invalid_credentials',
  'too_many_requests',
  'password_policy',
  'validation_failed',
  'forbidden',
  'unauthenticated',
  'slug_taken',
  'email_taken',
  'last_owner',
  'invalid_current_password',
  'template_name_taken',
  'maintenance_in_progress',
  'maintenance_completed',
  'invalid_window',
  'invalid_timezone',
  'layout_mismatch',
  'component_not_found',
]);

/** Mostra o erro da API traduzido (códigos conhecidos) ou uma mensagem genérica. */
export function ApiErrorAlert({ error }: { error: unknown }) {
  const t = useTranslations('errors');
  if (!error) return null;
  if (error instanceof ClientApiError) {
    if (error.code === 'password_policy') {
      const problems = (error.body?.problems as string[] | undefined) ?? [];
      return (
        <Alert>
          {t('password_policy')}
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{t(`password.${p}` as 'password.too_short')}</li>
            ))}
          </ul>
        </Alert>
      );
    }
    if (error.code === 'too_many_requests') {
      return (
        <Alert>{t('too_many_requests', { seconds: Number(error.body?.retryAfter ?? 60) })}</Alert>
      );
    }
    if (KNOWN.has(error.code)) return <Alert>{t(error.code as 'forbidden')}</Alert>;
  }
  return <Alert>{t('generic')}</Alert>;
}
