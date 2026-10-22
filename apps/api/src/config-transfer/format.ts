import { z } from 'zod';

/**
 * Formato do arquivo de configuração exportado (JSON versionado). As entidades
 * são revalidadas na importação com os mesmos schemas das telas; aqui só se
 * confere a estrutura. Referências entre entidades usam chaves do arquivo
 * (`key`), nunca IDs do banco de origem.
 */

export const CONFIG_FORMAT = 'status-page-config';
export const CONFIG_VERSION = 1;

/** Segredo: `p1.<iv>.<tag>.<dados>` (cifrado com a senha da exportação) ou `null`. */
const secret = z.string().max(200_000).nullable();
const key = z.string().min(1).max(64);
const record = z.record(z.string(), z.unknown());

export const configFileSchema = z.object({
  format: z.literal(CONFIG_FORMAT),
  version: z.literal(CONFIG_VERSION),
  exportedAt: z.string(),
  appVersion: z.string().optional(),
  secrets: z
    .object({
      kdf: z.literal('scrypt'),
      salt: z.string().max(64),
      N: z.number().int(),
      r: z.number().int(),
      p: z.number().int(),
    })
    .nullable(),
  components: z
    .array(z.object({ key, name: z.string(), description: z.string().nullable() }))
    .max(5000),
  pages: z
    .array(
      z.object({
        slug: z.string(),
        settings: record,
        domains: z.array(z.string()).max(50),
        groups: z
          .array(
            z.object({
              key,
              name: z.string(),
              position: z.number().int(),
              collapsed: z.boolean(),
            }),
          )
          .max(500),
        components: z
          .array(
            z.object({
              component: key,
              group: key.nullable(),
              position: z.number().int(),
              showUptime: z.boolean(),
            }),
          )
          .max(2000),
        themes: z.array(z.object({ kind: z.enum(['draft', 'published']), data: record })).max(2),
        uploads: z
          .array(
            z.object({
              key,
              kind: z.string(),
              filename: z.string(),
              data: z.string().max(4_000_000),
            }),
          )
          .max(50),
        templates: z.array(record).max(500),
        notificationTemplates: z.array(record).max(1000),
        channels: z.array(record.and(z.object({ config: secret }))).max(200),
        monitors: z.array(record.and(z.object({ headers: secret }))).max(2000),
        inboundSources: z.array(record.and(z.object({ hmacSecret: secret }))).max(200),
      }),
    )
    .max(200),
  ldapProviders: z
    .array(
      record.and(
        z.object({
          bindPassword: secret,
          mappings: z.array(
            z.object({ groupDn: z.string(), page: z.string().nullable(), role: z.string() }),
          ),
        }),
      ),
    )
    .max(50),
});

export type ConfigFile = z.infer<typeof configFileSchema>;
export type ConfigPage = ConfigFile['pages'][number];

export const IMPORT_MODES = ['merge', 'replace'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const exportRequestSchema = z.object({
  /** Páginas exportadas; vazio = todas. */
  pageIds: z.array(z.uuid()).max(200).default([]),
  /** Com senha, os segredos (webhooks, tokens, senhas) vão cifrados com ela. */
  password: z
    .string()
    .max(200)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || v.length >= 12, { message: 'password_too_short' }),
  includeLdap: z.boolean().default(true),
});

export const importOptionsSchema = z.object({
  mode: z.enum(IMPORT_MODES).default('merge'),
  password: z
    .string()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  /** `true`: só simula e devolve o relatório (nada é gravado). */
  dryRun: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(true)
    .transform((v) => v === true || v === 'true'),
});
