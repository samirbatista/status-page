import type { Messages } from '@status-page/i18n';
import type { routing } from './i18n/routing';

// Tipagem das chaves de tradução e dos idiomas no next-intl.
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: Messages;
  }
}
