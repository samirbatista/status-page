export const LOCALES = ['pt-BR', 'en-US', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt-BR';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
