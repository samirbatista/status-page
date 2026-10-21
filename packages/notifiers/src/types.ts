import {
  type Locale,
  type NotificationEventPayload,
  type NotificationEventType,
} from '@status-page/shared';

/** Retrato do evento (ver `NotificationEventPayload` no pacote shared). */
export type EventPayload = NotificationEventPayload;

export interface MessageLinks {
  /** Página de status. */
  pageUrl: string;
  /** Incidente ou manutenção na página pública. */
  itemUrl: string;
  /** Só para assinantes: gerenciar e cancelar a inscrição. */
  manageUrl?: string;
  unsubscribeUrl?: string;
}

/** Mensagem pronta, independente do canal; cada adaptador a formata do seu jeito. */
export interface RenderedMessage {
  locale: Locale;
  event: NotificationEventType;
  subject: string;
  /** Texto principal (já com as variáveis substituídas). */
  text: string;
  /** Título curto (do incidente/manutenção). */
  title: string;
  /** Cor de destaque (hex), conforme impacto ou tipo de evento. */
  color: string;
  facts: { label: string; value: string }[];
  links: MessageLinks;
  labels: { view: string; manage: string; unsubscribe: string; footer: string };
}

/** Falha no envio. `retryable` diz se vale tentar de novo (rede, 5xx, 429). */
export class NotifierError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

// --- Configurações globais e de canal (já decifradas) -------------------------------

export interface SmtpSettings {
  host: string;
  port: number;
  security: 'none' | 'starttls' | 'tls';
  verifyCertificate: boolean;
  username: string;
  password: string;
  from: string;
}

export interface TelegramSettings {
  botToken: string;
  apiUrl?: string;
}

export interface WhatsappSettings {
  phoneNumberId: string;
  accessToken: string;
  notificationTemplate: string;
  authTemplate: string;
  templateLanguage: string;
  apiUrl?: string;
}

export interface ProviderSettings {
  smtp?: SmtpSettings | null;
  telegram?: TelegramSettings | null;
  whatsapp?: WhatsappSettings | null;
}

/** Destino de um envio: canal da equipe (config) ou assinante (contato). */
export type Destination =
  | { kind: 'email'; recipients: string[] }
  | { kind: 'telegram'; chatId: string }
  | { kind: 'slack' | 'discord' | 'teams' | 'google_chat'; webhookUrl: string }
  | { kind: 'whatsapp'; phones: string[] }
  | { kind: 'webhook'; url: string; secret?: string };
