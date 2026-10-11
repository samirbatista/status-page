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
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}
