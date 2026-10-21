import { z } from 'zod';

/** Variáveis comuns a todos os serviços de backend. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

/**
 * Chave mestra usada para cifrar segredos em repouso (AES-256-GCM).
 * 32 bytes em base64 — gere com `openssl rand -base64 32`.
 */
export const appSecretEnvSchema = z.object({
  APP_SECRET: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: 'APP_SECRET deve ter 32 bytes codificados em base64 (openssl rand -base64 32)',
  }),
});

/**
 * Valida `process.env` contra o schema. Em caso de erro, lista todas as
 * variáveis inválidas de uma vez e encerra o processo.
 */
export function loadEnv<T extends z.ZodType>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${details}`);
  }
  return result.data;
}

/** Notificações: endereço público (links nas mensagens) e endpoints dos provedores. */
export const notifyEnvSchema = z.object({
  /** Endereço público do site, ex.: https://status.empresa.com.br */
  PUBLIC_URL: z.url({ protocol: /^https?$/ }).default('http://localhost'),
  /** Substituem as APIs reais em laboratório/testes. */
  TELEGRAM_API_URL: z.url().optional(),
  WHATSAPP_API_URL: z.url().optional(),
  /** Hosts extras aceitos em webhooks de assinantes (vírgula), só para laboratório. */
  WEBHOOK_EXTRA_HOSTS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
});

export type NotifyEnvVars = z.infer<typeof notifyEnvSchema>;

/** Converte as variáveis no formato usado pelos notifiers. */
export function notifyEnv(env: NotifyEnvVars) {
  return {
    publicUrl: env.PUBLIC_URL,
    telegramApiUrl: env.TELEGRAM_API_URL,
    whatsappApiUrl: env.WHATSAPP_API_URL,
    webhookExtraHosts: env.WEBHOOK_EXTRA_HOSTS,
  };
}
