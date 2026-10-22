import { z } from 'zod';
import {
  appSecretEnvSchema,
  baseEnvSchema,
  databaseEnvSchema,
  loadEnv,
  notifyEnvSchema,
  redisEnvSchema,
} from '@status-page/config';

export const apiEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(appSecretEnvSchema.shape)
  .extend(notifyEnvSchema.shape)
  .extend({
    API_PORT: z.coerce.number().int().positive().default(3001),
    /** Sessão expira após este tempo sem uso. */
    SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(60),
    /** Duração máxima da sessão, mesmo com uso contínuo. */
    SESSION_MAX_HOURS: z.coerce.number().int().positive().default(12),
    /** Diretório dos arquivos enviados (logos, fontes). Em Docker, um volume. */
    UPLOAD_DIR: z.string().min(1).default('./data/uploads'),
    /** Cache do resumo das páginas públicas para visitantes anônimos (0 desliga). */
    PUBLIC_CACHE_SECONDS: z.coerce.number().int().min(0).max(60).default(5),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}
