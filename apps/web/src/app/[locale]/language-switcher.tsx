'use client';

import { LOCALES, type Locale } from '@status-page/shared';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

const LABELS: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (US)',
  es: 'Español',
};

export function LanguageSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
      {t('language')}
      <select
        className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)]"
        value={locale}
        onChange={(event) => router.replace(pathname, { locale: event.target.value as Locale })}
      >
        {LOCALES.map((option) => (
          <option key={option} value={option}>
            {LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
