import { BadRequestException, Injectable } from '@nestjs/common';
import { type AuditContext, recordAudit } from '@status-page/core';
import { type Prisma } from '@status-page/db';
import {
  NotifierError,
  readSetting,
  sendEmail,
  SETTING_KEYS,
  type StoredSmtp,
  type StoredTelegram,
  type StoredWhatsapp,
  telegramCall,
  whatsappCode,
} from '@status-page/notifiers';
import {
  type smtpSettingsSchema,
  type telegramSettingsSchema,
  type whatsappSettingsSchema,
} from '@status-page/shared';
import { type z } from 'zod';
import { NotifyService } from '../infra/notify.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SecretsService } from '../infra/secrets.service.js';

type SmtpInput = z.infer<typeof smtpSettingsSchema>;
type TelegramInput = z.infer<typeof telegramSettingsSchema>;
type WhatsappInput = z.infer<typeof whatsappSettingsSchema>;

/** Configurações globais dos provedores (Dono). Segredos nunca voltam para a tela. */
@Injectable()
export class ProviderSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly notify: NotifyService,
  ) {}

  async get() {
    const db = this.prisma.client;
    const [smtp, telegram, whatsapp] = await Promise.all([
      readSetting<StoredSmtp>(db, SETTING_KEYS.smtp),
      readSetting<StoredTelegram>(db, SETTING_KEYS.telegram),
      readSetting<StoredWhatsapp>(db, SETTING_KEYS.whatsapp),
    ]);
    return {
      smtp: smtp
        ? { ...withoutKeys(smtp, ['passwordEnc']), hasPassword: Boolean(smtp.passwordEnc) }
        : null,
      telegram: telegram
        ? {
            enabled: telegram.enabled,
            botUsername: telegram.botUsername ?? null,
            hasToken: Boolean(telegram.botTokenEnc),
          }
        : null,
      whatsapp: whatsapp
        ? {
            ...withoutKeys(whatsapp, ['accessTokenEnc']),
            hasToken: Boolean(whatsapp.accessTokenEnc),
          }
        : null,
    };
  }

  async saveSmtp(input: SmtpInput, audit: AuditContext) {
    const before = await readSetting<StoredSmtp>(this.prisma.client, SETTING_KEYS.smtp);
    const { password, ...rest } = input;
    const value: StoredSmtp = {
      ...rest,
      passwordEnc: password ? this.secrets.encrypt(password) : before?.passwordEnc,
    };
    await this.store(SETTING_KEYS.smtp, value, audit, { ...rest, passwordChanged: !!password });
    return this.get();
  }

  /** Valida o token no Telegram (getMe) e guarda o nome do bot para os links t.me. */
  async saveTelegram(input: TelegramInput, audit: AuditContext) {
    const before = await readSetting<StoredTelegram>(this.prisma.client, SETTING_KEYS.telegram);
    const botTokenEnc = input.botToken ? this.secrets.encrypt(input.botToken) : before?.botTokenEnc;
    if (input.enabled && !botTokenEnc) throw new BadRequestException({ message: 'token_required' });
    let botUsername = before?.botUsername;
    if (input.botToken) {
      try {
        const me = (await telegramCall(
          { botToken: input.botToken, apiUrl: this.notify.env.telegramApiUrl },
          'getMe',
          {},
        )) as { username?: string };
        botUsername = me.username;
      } catch (error) {
        throw new BadRequestException({ message: 'telegram_invalid_token', reason: reason(error) });
      }
    }
    await this.store(
      SETTING_KEYS.telegram,
      { enabled: input.enabled, botTokenEnc, botUsername },
      audit,
      { enabled: input.enabled, botUsername, tokenChanged: !!input.botToken },
    );
    return this.get();
  }

  async saveWhatsapp(input: WhatsappInput, audit: AuditContext) {
    const before = await readSetting<StoredWhatsapp>(this.prisma.client, SETTING_KEYS.whatsapp);
    const { accessToken, ...rest } = input;
    const accessTokenEnc = accessToken ? this.secrets.encrypt(accessToken) : before?.accessTokenEnc;
    if (input.enabled && !accessTokenEnc)
      throw new BadRequestException({ message: 'token_required' });
    await this.store(SETTING_KEYS.whatsapp, { ...rest, accessTokenEnc }, audit, {
      ...rest,
      tokenChanged: !!accessToken,
    });
    return this.get();
  }

  /** Envia um e-mail de teste (com a configuração salva). */
  async testSmtp(to: string) {
    const providers = await this.notify.providers();
    if (!providers.smtp) throw new BadRequestException({ message: 'smtp_not_configured' });
    try {
      await sendEmail(providers.smtp, [to], {
        subject: 'Status Page: teste de SMTP',
        text: 'Se você recebeu esta mensagem, o SMTP está configurado corretamente.',
      });
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: reason(error) };
    }
  }

  /** Envia o template de autenticação com o código 123456 para o número informado. */
  async testWhatsapp(phone: string) {
    const providers = await this.notify.providers();
    if (!providers.whatsapp) throw new BadRequestException({ message: 'whatsapp_not_configured' });
    try {
      await whatsappCode(providers.whatsapp, phone, '123456');
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: reason(error) };
    }
  }

  private async store(key: string, value: object, audit: AuditContext, auditAfter: object) {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue, encrypted: true },
        update: { value: value as Prisma.InputJsonValue, encrypted: true },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'settings.notify_update',
        entityType: 'setting',
        entityId: key,
        after: auditAfter,
      });
    });
  }
}

function withoutKeys<T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

export function reason(error: unknown): string {
  return error instanceof NotifierError || error instanceof Error
    ? error.message.slice(0, 300)
    : String(error);
}
