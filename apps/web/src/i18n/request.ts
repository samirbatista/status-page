import { getMessages } from '@status-page/i18n';
import { isLocale } from '@status-page/shared';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : routing.defaultLocale;
  return { locale, messages: getMessages(locale) };
});
