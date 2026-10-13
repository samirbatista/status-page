import { z } from 'zod';
import { LOCALES } from './locales.js';
import { PASSWORD_MAX_LENGTH } from './password.js';
import { ROLES } from './roles.js';
import {
  COMPONENT_STATUSES,
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  MAINTENANCE_STATUSES,
} from './status.js';

/**
 * Schemas de entrada da API, compartilhados com o frontend. A política de senha
 * (comprimento mínimo, senhas comuns) é verificada no servidor com `checkPassword`.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const uuid = z.uuid();
const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const password = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const isoDate = z.coerce.date();

export const componentStatusSchema = z.enum(COMPONENT_STATUSES);
export const incidentStatusSchema = z.enum(INCIDENT_STATUSES);
export const incidentImpactSchema = z.enum(INCIDENT_IMPACTS);
export const maintenanceStatusSchema = z.enum(MAINTENANCE_STATUSES);
export const pageRoleSchema = z.enum(ROLES).exclude(['owner']);

// --- Autenticação -----------------------------------------------------------

export const loginSchema = z.object({ email, password });
export const changePasswordSchema = z.object({
  currentPassword: password,
  newPassword: password,
});

// --- Usuários ---------------------------------------------------------------

export const userCreateSchema = z.object({
  email,
  name: text(120),
  password,
  isOwner: z.boolean().default(false),
});
export const userUpdateSchema = z.object({
  name: text(120).optional(),
  isOwner: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
export const resetPasswordSchema = z.object({ password });
export const pageRoleAssignSchema = z.object({ userId: uuid, role: pageRoleSchema });

// --- Páginas e componentes --------------------------------------------------

export const pageCreateSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, 'slug inválido')
    .refine((v) => !['admin', 'api', 'p', 'healthz'].includes(v), 'slug reservado'),
  name: text(120),
  description: optionalText(500),
  defaultLocale: z.enum(LOCALES).default('pt-BR'),
  timezone: z.string().trim().min(1).max(64).default('America/Sao_Paulo'),
  visibility: z.enum(['public', 'private']).default('public'),
});
export const pageUpdateSchema = pageCreateSchema.omit({ slug: true }).partial();

export const groupCreateSchema = z.object({
  name: text(120),
  collapsed: z.boolean().default(false),
});
export const groupUpdateSchema = groupCreateSchema.partial();

export const componentCreateSchema = z.object({
  name: text(120),
  description: optionalText(500),
  groupId: uuid.nullable().optional(),
  showUptime: z.boolean().default(true),
  status: componentStatusSchema.default('operational'),
});
export const componentUpdateSchema = componentCreateSchema.omit({ status: true }).partial();
export const componentStatusUpdateSchema = z.object({ status: componentStatusSchema });

/** Ordem completa dos grupos e componentes da página. */
export const layoutSchema = z.object({
  groups: z.array(uuid).max(200),
  components: z.array(z.object({ componentId: uuid, groupId: uuid.nullable() })).max(500),
});

// --- Incidentes -------------------------------------------------------------

const affectedComponents = z
  .array(z.object({ componentId: uuid, status: componentStatusSchema }))
  .max(200)
  .default([]);

export const incidentCreateSchema = z
  .object({
    title: text(200),
    status: incidentStatusSchema.default('investigating'),
    impact: incidentImpactSchema.default('minor'),
    body: text(10_000),
    notify: z.boolean().default(true),
    components: affectedComponents,
    /** Incidente retroativo: já resolvido, com início e fim no passado. */
    backfill: z.object({ startedAt: isoDate, resolvedAt: isoDate }).optional(),
  })
  .refine((v) => !v.backfill || v.backfill.startedAt < v.backfill.resolvedAt, {
    path: ['backfill', 'resolvedAt'],
    message: 'o fim deve ser posterior ao início',
  });

export const incidentUpdateCreateSchema = z.object({
  status: incidentStatusSchema,
  body: text(10_000),
  notify: z.boolean().default(true),
  components: affectedComponents,
});

export const incidentEditSchema = z.object({
  title: text(200).optional(),
  impact: incidentImpactSchema.optional(),
});

export const incidentTemplateSchema = z.object({
  name: text(120),
  title: text(200),
  body: text(10_000),
  status: incidentStatusSchema.default('investigating'),
  impact: incidentImpactSchema.default('minor'),
  componentIds: z.array(uuid).max(200).default([]),
  componentStatus: componentStatusSchema.nullable().default(null),
});

// --- Manutenções ------------------------------------------------------------

export const maintenanceCreateSchema = z
  .object({
    title: text(200),
    body: text(10_000),
    scheduledStart: isoDate,
    scheduledEnd: isoDate,
    autoStart: z.boolean().default(true),
    autoComplete: z.boolean().default(true),
    componentIds: z.array(uuid).max(200).default([]),
    notify: z.boolean().default(true),
  })
  .refine((v) => v.scheduledStart < v.scheduledEnd, {
    path: ['scheduledEnd'],
    message: 'o fim deve ser posterior ao início',
  });

export const maintenanceEditSchema = z.object({
  title: text(200).optional(),
  scheduledStart: isoDate.optional(),
  scheduledEnd: isoDate.optional(),
  autoStart: z.boolean().optional(),
  autoComplete: z.boolean().optional(),
  componentIds: z.array(uuid).max(200).optional(),
});

export const maintenanceUpdateCreateSchema = z.object({
  body: z.string().trim().max(10_000).default(''),
  /** `in_progress` inicia e `completed` conclui a manutenção. */
  status: z.enum(['in_progress', 'completed']).optional(),
  notify: z.boolean().default(true),
});

// --- Auditoria --------------------------------------------------------------

export const auditQuerySchema = z.object({
  pageId: uuid.optional(),
  actorId: uuid.optional(),
  entityType: z.string().max(64).optional(),
  action: z.string().max(64).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type PageCreateInput = z.infer<typeof pageCreateSchema>;
export type ComponentCreateInput = z.infer<typeof componentCreateSchema>;
export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>;
export type IncidentUpdateCreateInput = z.infer<typeof incidentUpdateCreateSchema>;
export type MaintenanceCreateInput = z.infer<typeof maintenanceCreateSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
