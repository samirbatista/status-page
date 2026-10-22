import { z } from 'zod';
import { ROLES } from './roles.js';

/** Tokens da API administrativa (`Authorization: Bearer sp_...`). */

export const API_TOKEN_PREFIX = 'sp_';
export const API_TOKEN_ROLES = ROLES.filter((r) => r !== 'owner') as [
  'viewer',
  'operator',
  'admin',
];

export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(API_TOKEN_ROLES).default('viewer'),
  /** Validade em dias; vazio = não expira. */
  expiresInDays: z.coerce.number().int().min(1).max(3650).nullish(),
});
export type ApiTokenCreateInput = z.infer<typeof apiTokenCreateSchema>;
