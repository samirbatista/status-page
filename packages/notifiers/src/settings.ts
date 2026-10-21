import { type Db, type SecretBox } from '@status-page/core';
import {
  type SmtpSettings,
  type TelegramSettings,
  type WhatsappSettings,
  type ProviderSettings,
} from './types.js';

/**
 * Configurações globais dos provedores (Dono), guardadas na tabela `settings`.
 * Os segredos ficam cifrados dentro do JSON (`*Enc`).
 */
export const SETTING_KEYS = {
  smtp: 'notify.smtp',
  telegram: 'notify.telegram',
  whatsapp: 'notify.whatsapp',
} as const;

export interface StoredSmtp extends Omit<SmtpSettings, 'password'> {
  enabled: boolean;
  passwordEnc?: string;
}
export interface StoredTelegram {
  enabled: boolean;
  botTokenEnc?: string;
  /** Nome do bot (sem @), lido do getMe ao salvar: monta o link t.me/<bot>. */
  botUsername?: string;
}
export interface StoredWhatsapp extends Omit<WhatsappSettings, 'accessToken' | 'apiUrl'> {
  enabled: boolean;
  accessTokenEnc?: string;
}

/** Ambiente: URLs públicas e endpoints das APIs (substituíveis em laboratório). */
export interface NotifyEnv {
  /** Endereço público do site (ex.: https://status.empresa.com), para os links. */
  publicUrl: string;
  telegramApiUrl?: string;
  whatsappApiUrl?: string;
  /** Hosts extras aceitos em webhooks de assinantes (laboratório). */
  webhookExtraHosts?: string[];
}

export async function readSetting<T>(db: Db, key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

/** Provedores habilitados e prontos para uso, com os segredos decifrados. */
export async function loadProviderSettings(
  db: Db,
  secrets: SecretBox,
  env: Pick<NotifyEnv, 'telegramApiUrl' | 'whatsappApiUrl'>,
): Promise<ProviderSettings & { telegramBotUsername?: string }> {
  const [smtp, telegram, whatsapp] = await Promise.all([
    readSetting<StoredSmtp>(db, SETTING_KEYS.smtp),
    readSetting<StoredTelegram>(db, SETTING_KEYS.telegram),
    readSetting<StoredWhatsapp>(db, SETTING_KEYS.whatsapp),
  ]);
  const result: ProviderSettings & { telegramBotUsername?: string } = {};
  if (smtp?.enabled) {
    const { enabled: _e, passwordEnc, ...rest } = smtp;
    void _e;
    result.smtp = { ...rest, password: passwordEnc ? secrets.decrypt(passwordEnc) : '' };
  }
  if (telegram?.enabled && telegram.botTokenEnc) {
    const settings: TelegramSettings = { botToken: secrets.decrypt(telegram.botTokenEnc) };
    if (env.telegramApiUrl) settings.apiUrl = env.telegramApiUrl;
    result.telegram = settings;
    result.telegramBotUsername = telegram.botUsername;
  }
  if (whatsapp?.enabled && whatsapp.accessTokenEnc) {
    const { enabled: _e, accessTokenEnc, ...rest } = whatsapp;
    void _e;
    result.whatsapp = {
      ...rest,
      accessToken: secrets.decrypt(accessTokenEnc),
      ...(env.whatsappApiUrl ? { apiUrl: env.whatsappApiUrl } : {}),
    };
  }
  return result;
}
