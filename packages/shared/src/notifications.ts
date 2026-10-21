import { z } from 'zod';
import { LOCALES } from './locales.js';
import {
  type ComponentStatus,
  type IncidentImpact,
  type IncidentStatus,
  type MaintenanceStatus,
} from './status.js';

/** Canais de notificação, da equipe e dos assinantes. */
export const NOTIFICATION_KINDS = [
  'email',
  'telegram',
  'slack',
  'discord',
  'teams',
  'google_chat',
  'whatsapp',
  'webhook',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Canais que o visitante pode assinar (o webhook genérico é só da equipe). */
export const SUBSCRIBER_KINDS = [
  'email',
  'telegram',
  'slack',
  'discord',
  'teams',
  'google_chat',
  'whatsapp',
] as const satisfies readonly NotificationKind[];
export type SubscriberKind = (typeof SUBSCRIBER_KINDS)[number];

/** Canais cujo destino é uma URL de webhook informada pelo visitante. */
export const WEBHOOK_SUBSCRIBER_KINDS = ['slack', 'discord', 'teams', 'google_chat'] as const;

export const NOTIFICATION_EVENT_TYPES = [
  'incident_created',
  'incident_updated',
  'incident_resolved',
  'maintenance_scheduled',
  'maintenance_reminder',
  'maintenance_started',
  'maintenance_updated',
  'maintenance_completed',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/** Categorias que canais e assinantes escolhem receber. */
export const EVENT_CATEGORIES = ['incident', 'maintenance'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export function eventCategory(type: NotificationEventType): EventCategory {
  return type.startsWith('incident') ? 'incident' : 'maintenance';
}

/**
 * Domínios aceitos para webhooks informados por assinantes (proteção contra
 * SSRF). Além do domínio, o endereço resolvido não pode ser privado.
 */
export const SUBSCRIBER_WEBHOOK_HOSTS: Record<(typeof WEBHOOK_SUBSCRIBER_KINDS)[number], string[]> =
  {
    slack: ['hooks.slack.com'],
    discord: ['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'],
    // Webhooks de Workflows (Power Automate); os "Office 365 Connectors" foram descontinuados.
    teams: ['*.logic.azure.com', '*.environment.api.powerplatform.com'],
    google_chat: ['chat.googleapis.com'],
  };

/** Variáveis aceitas nos templates de mensagem. */
export const TEMPLATE_VARIABLES = [
  'page.name',
  'page.url',
  'event.label',
  'incident.title',
  'incident.status',
  'incident.impact',
  'incident.url',
  'maintenance.title',
  'maintenance.status',
  'maintenance.start',
  'maintenance.end',
  'maintenance.url',
  'update.body',
  'components',
  'component.name',
] as const;

/** Variáveis usadas no template (`{{ nome }}`), na ordem em que aparecem. */
export function templateVariables(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
}

const locale = z.enum(LOCALES);
const events = z
  .array(z.enum(EVENT_CATEGORIES))
  .min(1)
  .max(2)
  .transform((v) => [...new Set(v)]);
const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);
const emailList = z
  .array(z.email().max(254))
  .min(1)
  .max(50)
  .transform((v) => v.map((e) => e.toLowerCase()));
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s().-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, { message: 'invalid_phone' }));

// --- Canais da equipe -----------------------------------------------------------

/** Configuração de cada tipo de canal da equipe. */
export const channelConfigSchemas = {
  email: z.object({ recipients: emailList }),
  telegram: z.object({
    chatId: z
      .string()
      .trim()
      .regex(/^-?\d{1,20}$|^@[\w]{5,64}$/, { message: 'invalid_chat_id' }),
  }),
  slack: z.object({ webhookUrl: httpUrl }),
  discord: z.object({ webhookUrl: httpUrl }),
  teams: z.object({ webhookUrl: httpUrl }),
  google_chat: z.object({ webhookUrl: httpUrl }),
  whatsapp: z.object({ phones: z.array(phone).min(1).max(20) }),
  webhook: z.object({
    url: httpUrl,
    /** Segredo do HMAC-SHA256; em branco na edição mantém o atual. */
    secret: z.string().max(256).optional(),
  }),
} satisfies Record<NotificationKind, z.ZodType>;

export const channelCreateSchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  events: events.default(['incident', 'maintenance']),
  locale: locale.default('pt-BR'),
  config: z.record(z.string(), z.unknown()),
});
export const channelUpdateSchema = channelCreateSchema.omit({ kind: true });

// --- Templates ----------------------------------------------------------------

export const templateUpsertSchema = z.object({
  channel: z.enum([...NOTIFICATION_KINDS, 'all']),
  event: z.enum(NOTIFICATION_EVENT_TYPES),
  locale,
  subject: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  body: z.string().trim().min(1).max(4000),
});

// --- Configurações globais (Dono) -------------------------------------------------

export const SMTP_SECURITY = ['none', 'starttls', 'tls'] as const;

export const smtpSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65_535),
  security: z.enum(SMTP_SECURITY),
  verifyCertificate: z.boolean().default(true),
  username: z.string().trim().max(255).default(''),
  /** Em branco mantém a senha atual. */
  password: z.string().max(1024).optional(),
  from: z.string().trim().min(3).max(320),
});

export const telegramSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Em branco mantém o token atual. */
  botToken: z
    .string()
    .trim()
    .regex(/^\d+:[\w-]{20,}$/, { message: 'invalid_bot_token' })
    .optional()
    .or(z.literal('')),
});

export const whatsappSettingsSchema = z.object({
  enabled: z.boolean(),
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,30}$/, { message: 'invalid_phone_number_id' }),
  /** Em branco mantém o token atual. */
  accessToken: z.string().trim().max(1024).optional(),
  /** Template aprovado com 2 variáveis no corpo: título e texto. */
  notificationTemplate: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/, { message: 'invalid_template' }),
  /** Template de autenticação (categoria AUTHENTICATION) com o código. */
  authTemplate: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/, { message: 'invalid_template' }),
  /** Idioma dos templates na Meta (ex.: pt_BR). */
  templateLanguage: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(_[A-Z]{2})?$/, { message: 'invalid_language' }),
});

// --- Inscrição pública -------------------------------------------------------------

/** Texto de consentimento registrado junto com a inscrição (LGPD). */
export const CONSENT_VERSION = 'v1';

export const subscribeSchema = z
  .object({
    kind: z.enum(SUBSCRIBER_KINDS),
    /** E-mail, telefone (+55...) ou URL do webhook; vazio para o Telegram. */
    target: z.string().trim().max(2048).default(''),
    locale,
    allComponents: z.boolean().default(true),
    componentIds: z.array(z.uuid()).max(500).default([]),
    events: events.default(['incident', 'maintenance']),
    /** O visitante marcou a caixa de consentimento. */
    consent: z.literal(true),
  })
  .superRefine((value, ctx) => {
    const check = (schema: z.ZodType) => {
      const result = schema.safeParse(value.target);
      if (!result.success) {
        ctx.addIssue({ code: 'custom', path: ['target'], message: 'invalid_target' });
      }
    };
    if (value.kind === 'email') check(z.email().max(254));
    else if (value.kind === 'whatsapp') check(phone);
    // HTTPS e domínio permitido são conferidos na proteção contra SSRF.
    else if (value.kind !== 'telegram') check(httpUrl);
    if (!value.allComponents && value.componentIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['componentIds'], message: 'components_required' });
    }
  });
export type SubscribeInput = z.infer<typeof subscribeSchema>;

export const subscriptionCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, { message: 'invalid_code' })),
});

export const subscriptionUpdateSchema = z
  .object({
    locale,
    allComponents: z.boolean(),
    componentIds: z.array(z.uuid()).max(500).default([]),
    events,
  })
  .refine((v) => v.allComponents || v.componentIds.length > 0, {
    message: 'components_required',
    path: ['componentIds'],
  });

/** Normaliza o contato para comparação (e-mail em minúsculas, telefone sem pontuação). */
export function normalizeTarget(kind: NotificationKind, target: string): string {
  const value = target.trim();
  if (kind === 'email') return value.toLowerCase();
  if (kind === 'whatsapp') return value.replace(/[\s().-]/g, '');
  return value;
}

/** Contato mascarado para exibição: an***@empresa.com, +55******1234, hooks.slack.com/... */
export function maskTarget(kind: NotificationKind, target: string): string {
  if (kind === 'email') {
    const [user = '', domain = ''] = target.split('@');
    return `${user.slice(0, 2)}***@${domain}`;
  }
  if (kind === 'whatsapp') return `${target.slice(0, 3)}******${target.slice(-4)}`;
  if (kind === 'telegram') return `chat ${target.slice(0, 3)}***`;
  try {
    const url = new URL(target);
    return `${url.host}/…`;
  } catch {
    return '***';
  }
}

/**
 * Retrato do evento, gravado em `NotificationEvent.payload` no momento da
 * mudança: as mensagens saem iguais mesmo que o incidente mude depois.
 */
export interface NotificationEventPayload {
  type: NotificationEventType;
  page: { id: string; name: string; slug: string; timezone: string };
  incident?: { id: string; title: string; status: IncidentStatus; impact: IncidentImpact };
  maintenance?: {
    id: string;
    title: string;
    status: MaintenanceStatus;
    scheduledStart: string;
    scheduledEnd: string;
  };
  update?: { body: string };
  components: { id: string; name: string; status?: ComponentStatus }[];
}
