import { z } from 'zod';
import { type COMPONENT_STATUSES } from './status.js';

/** Monitoramento, webhooks de entrada, alertas e postmortem. */

export const MONITOR_TYPES = ['http', 'tcp', 'icmp', 'dns', 'ssl'] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];

export const AUTOMATION_MODES = ['auto', 'suggest'] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const INBOUND_KINDS = [
  'alertmanager',
  'grafana',
  'zabbix',
  'uptime_kuma',
  'generic',
] as const;
export type InboundKind = (typeof INBOUND_KINDS)[number];

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'] as const;
export const MIN_INTERVAL_SECONDS = 30;

/** Status que a automação pode aplicar quando o serviço cai. */
export const FAILURE_STATUSES = [
  'degraded_performance',
  'partial_outage',
  'major_outage',
] as const satisfies readonly (typeof COMPONENT_STATUSES)[number][];

const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.:[\]_-]+$/, { message: 'invalid_host' });

/** Opções por tipo de checagem (vão em `Monitor.config`). */
export const monitorConfigSchemas = {
  http: z.object({
    method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
    /** Códigos aceitos, ex.: "200-299,301". */
    expectedStatus: z
      .string()
      .trim()
      .regex(/^\d{3}(-\d{3})?(,\s*\d{3}(-\d{3})?)*$/, { message: 'invalid_status_list' })
      .default('200-399'),
    keyword: z.string().max(500).default(''),
    /** A palavra-chave NÃO pode aparecer (ex.: "erro"). */
    keywordAbsent: z.boolean().default(false),
    followRedirects: z.boolean().default(true),
    verifyTls: z.boolean().default(true),
    body: z.string().max(10_000).default(''),
  }),
  tcp: z.object({ port: z.coerce.number().int().min(1).max(65_535) }),
  icmp: z.object({}),
  dns: z.object({
    recordType: z.enum(DNS_RECORD_TYPES).default('A'),
    /** Valor esperado (contido em alguma resposta); vazio só exige resolver. */
    expected: z.string().trim().max(500).default(''),
    /** Servidor DNS específico (IP); vazio usa o do sistema. */
    server: z
      .string()
      .trim()
      .max(64)
      .default('')
      .refine((v) => v === '' || /^[0-9a-fA-F.:]+$/.test(v), { message: 'invalid_dns_server' }),
  }),
  ssl: z.object({
    port: z.coerce.number().int().min(1).max(65_535).default(443),
    /** Falha quando faltam menos dias que isso para vencer. */
    minDaysLeft: z.coerce.number().int().min(0).max(365).default(14),
  }),
} as const;

const monitorBase = z.object({
  name: z.string().trim().min(1).max(120),
  componentId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  intervalSeconds: z.coerce.number().int().min(MIN_INTERVAL_SECONDS).max(86_400).default(60),
  timeoutMs: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  failureThreshold: z.coerce.number().int().min(1).max(20).default(3),
  recoveryThreshold: z.coerce.number().int().min(1).max(20).default(2),
  mode: z.enum(AUTOMATION_MODES).default('auto'),
  failureStatus: z.enum(FAILURE_STATUSES).default('major_outage'),
  templateId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  publicMetrics: z.boolean().default(false),
  enabled: z.boolean().default(true),
  /** Cabeçalhos HTTP (nome → valor). Em branco na edição mantém os atuais. */
  headers: z.record(z.string().regex(/^[\w-]{1,100}$/), z.string().max(2000)).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const monitorInputSchema = monitorBase
  .extend({
    type: z.enum(MONITOR_TYPES),
    target: z.string().trim().min(1).max(2048),
  })
  .superRefine((value, ctx) => {
    const config = monitorConfigSchemas[value.type].safeParse(value.config);
    if (!config.success) {
      // Repassa o problema original (código e limites) para o painel saber o tipo do erro.
      for (const issue of config.error.issues) {
        ctx.addIssue({ ...issue, path: ['config', ...issue.path] } as never);
      }
    }
    const target =
      value.type === 'http'
        ? z.url({ protocol: /^https?$/ }).safeParse(value.target)
        : host.safeParse(value.target);
    if (!target.success) {
      ctx.addIssue({ code: 'custom', path: ['target'], message: 'invalid_target' });
    }
  });
export type MonitorInput = z.infer<typeof monitorInputSchema>;

/** Converte "200-299,301" em uma função de aceite. */
export function statusMatcher(spec: string): (status: number) => boolean {
  const ranges = spec
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [from, to] = part.split('-').map(Number);
      return [from!, to ?? from!] as const;
    });
  return (status) => ranges.some(([from, to]) => status >= from && status <= to);
}

// --- Webhooks de entrada ------------------------------------------------------------

export const genericMappingSchema = z.object({
  /** Caminho (com pontos) até a lista de alertas; vazio = o corpo é um alerta só. */
  itemsPath: z.string().trim().max(200).default(''),
  /** Identificador estável do alerta (para casar disparo e normalização). */
  keyPath: z.string().trim().max(200).default('id'),
  namePath: z.string().trim().max(200).default('name'),
  statusPath: z.string().trim().max(200).default('status'),
  /** Valores do status que significam "em falha"; o resto é "normalizado". */
  firingValues: z.array(z.string().max(50)).max(20).default(['firing', 'down', 'problem', '1']),
  labelsPath: z.string().trim().max(200).default('labels'),
  summaryPath: z.string().trim().max(200).default('message'),
});
export type GenericMapping = z.infer<typeof genericMappingSchema>;

export const inboundSourceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(INBOUND_KINDS),
  mode: z.enum(AUTOMATION_MODES).default('suggest'),
  templateId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  enabled: z.boolean().default(true),
  /** Em branco mantém o atual; `null` remove a verificação HMAC. */
  hmacSecret: z.string().max(256).nullish(),
  mapping: genericMappingSchema.optional(),
});
export const inboundSourceUpdateSchema = inboundSourceInputSchema.omit({ kind: true });

export const inboundRuleInputSchema = z.object({
  /** `name` ou `label:<chave>`. */
  matchField: z
    .string()
    .trim()
    .regex(/^(name|label:[\w.-]{1,100})$/, { message: 'invalid_match_field' }),
  pattern: z.string().trim().min(1).max(500),
  componentId: z.uuid(),
  status: z.enum(FAILURE_STATUSES),
});

/** Curinga simples (`*`), sem diferenciar maiúsculas. */
export function globMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    'i',
  );
  return regex.test(value);
}

// --- Alertas e postmortem ---------------------------------------------------------------

export const alertAcceptSchema = z.object({
  /** Abrir um incidente a partir do template do monitor/origem (se houver). */
  openIncident: z.boolean().default(true),
});

export const postmortemSchema = z.object({
  body: z.string().max(100_000),
});
export const postmortemPublishSchema = z.object({ notify: z.boolean().default(true) });

export const METRIC_RANGES = ['day', 'week', 'month'] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];
