import { DEFAULT_LOCALE, LOCALES } from '@status-page/shared';
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // O idioma padrão fica sem prefixo na URL (/), os demais usam /en-US e /es.
  localePrefix: 'as-needed',
});
