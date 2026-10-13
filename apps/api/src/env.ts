import { z } from 'zod';
import {
  appSecretEnvSchema,
  baseEnvSchema,
  databaseEnvSchema,
  loadEnv,
  redisEnvSchema,
} from '@status-page/config';

export const apiEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(appSecretEnvSchema.shape)
  .extend({
    API_PORT: z.coerce.number().int().positive().default(3001),
    /** Sessão expira após este tempo sem uso. */
    SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(60),
    /** Duração máxima da sessão, mesmo com uso contínuo. */
    SESSION_MAX_HOURS: z.coerce.number().int().positive().default(12),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}
