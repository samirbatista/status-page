import { type Prisma } from '@status-page/db';
import {
  type ComponentStatus,
  type NotificationEventPayload,
  type NotificationEventType,
} from '@status-page/shared';
import { type Db } from './db.js';

/**
 * Grava o evento a notificar (outbox) na mesma transação da mudança. O worker
 * cria as entregas depois; se a fila estiver fora do ar, a varredura periódica
 * pega os eventos pendentes.
 */

async function pageInfo(db: Db, pageId: string) {
  const page = await db.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { id: true, name: true, slug: true, timezone: true },
  });
  return page;
}

/** Evento de incidente a partir de uma atualização (a mais recente, se omitida). */
export async function recordIncidentEvent(
  db: Db,
  incidentId: string,
  type: Extract<NotificationEventType, `incident_${string}`>,
  updateId?: string,
): Promise<string> {
  const incident = await db.incident.findUniqueOrThrow({
    where: { id: incidentId },
    include: {
      updates: {
        orderBy: { displayAt: 'desc' },
        include: { components: { include: { component: { select: { id: true, name: true } } } } },
      },
    },
  });
  const update = updateId ? incident.updates.find((u) => u.id === updateId) : incident.updates[0];
  // Componentes da atualização; sem eles, todos os já afetados pelo incidente.
  const seen = new Map<string, { id: string; name: string; status?: ComponentStatus }>();
  const sources = update && update.components.length > 0 ? [update] : incident.updates;
  for (const u of sources) {
    for (const c of u.components) {
      if (!seen.has(c.componentId)) {
        seen.set(c.componentId, { id: c.component.id, name: c.component.name, status: c.status });
      }
    }
  }
  const payload: NotificationEventPayload = {
    type,
    page: await pageInfo(db, incident.pageId),
    incident: {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
    },
    update: update ? { body: update.body } : undefined,
    components: [...seen.values()],
  };
  return createEvent(db, incident.pageId, payload, { incidentId });
}

export async function recordMaintenanceEvent(
  db: Db,
  maintenanceId: string,
  type: Extract<NotificationEventType, `maintenance_${string}`>,
  body?: string,
): Promise<string> {
  const maintenance = await db.maintenance.findUniqueOrThrow({
    where: { id: maintenanceId },
    include: {
      components: { include: { component: { select: { id: true, name: true } } } },
      updates: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const payload: NotificationEventPayload = {
    type,
    page: await pageInfo(db, maintenance.pageId),
    maintenance: {
      id: maintenance.id,
      title: maintenance.title,
      status: maintenance.status,
      scheduledStart: maintenance.scheduledStart.toISOString(),
      scheduledEnd: maintenance.scheduledEnd.toISOString(),
    },
    update: { body: body ?? maintenance.updates[0]?.body ?? '' },
    components: maintenance.components.map((c) => ({ id: c.component.id, name: c.component.name })),
  };
  return createEvent(db, maintenance.pageId, payload, { maintenanceId });
}

async function createEvent(
  db: Db,
  pageId: string,
  payload: NotificationEventPayload,
  refs: { incidentId?: string; maintenanceId?: string },
): Promise<string> {
  const event = await db.notificationEvent.create({
    data: {
      pageId,
      type: payload.type,
      ...refs,
      componentIds: payload.components.map((c) => c.id),
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
  return event.id;
}

/** Status de componente alterado pela automação, sem incidente aberto. */
export async function recordComponentEvent(
  db: Db,
  pageId: string,
  componentId: string,
  body: string,
): Promise<string> {
  const component = await db.component.findUniqueOrThrow({
    where: { id: componentId },
    select: { id: true, name: true, status: true },
  });
  const payload: NotificationEventPayload = {
    type: 'component_status_changed',
    page: await pageInfo(db, pageId),
    update: { body },
    components: [component],
  };
  return createEvent(db, pageId, payload, {});
}

/** Postmortem publicado: vai para quem assina incidentes. */
export async function recordPostmortemEvent(db: Db, incidentId: string): Promise<string> {
  const incident = await db.incident.findUniqueOrThrow({
    where: { id: incidentId },
    include: {
      updates: {
        include: { components: { include: { component: { select: { id: true, name: true } } } } },
      },
    },
  });
  const components = new Map<string, { id: string; name: string }>();
  for (const u of incident.updates) {
    for (const c of u.components) components.set(c.component.id, c.component);
  }
  const payload: NotificationEventPayload = {
    type: 'postmortem_published',
    page: await pageInfo(db, incident.pageId),
    incident: {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
    },
    components: [...components.values()],
  };
  return createEvent(db, incident.pageId, payload, { incidentId });
}
