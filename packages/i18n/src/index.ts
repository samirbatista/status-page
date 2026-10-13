import { DEFAULT_LOCALE, type Locale } from '@status-page/shared';
import enUS from './messages/en-US.json' with { type: 'json' };
import es from './messages/es.json' with { type: 'json' };
import ptBR from './messages/pt-BR.json' with { type: 'json' };

/** O pt-BR é a fonte da verdade: os demais idiomas devem ter exatamente as mesmas chaves. */
export type Messages = typeof ptBR;

export const messages: Record<Locale, Messages> = {
  'pt-BR': ptBR,
  'en-US': enUS,
  es,
};

export function getMessages(locale: Locale = DEFAULT_LOCALE): Messages {
  return messages[locale];
}
