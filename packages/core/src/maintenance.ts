import { type PrismaClient } from '@status-page/db';
import { type Db } from './db.js';
import { recordAudit } from './audit.js';
import { setComponentStatuses } from './component-status.js';

export interface TransitionOptions {
  actorId?: string | null;
  at?: Date;
  /** Texto da atualização. Vazio = mensagem padrão traduzida na exibição. */
  body?: string;
  notify?: boolean;
}

/** Coloca a manutenção em andamento e os componentes em `under_maintenance`. */
export async function startMaintenance(
  db: Db,
  maintenanceId: string,
  options: TransitionOptions = {},
): Promise<boolean> {
  const at = options.at ?? new Date();
  const maintenance = await db.maintenance.findUnique({
    where: { id: maintenanceId },
    include: { components: { include: { component: { select: { status: true } } } } },
  });
  if (!maintenance || maintenance.status !== 'scheduled') return false;

  // Transição condicional: com vários workers, só quem "reivindica" a linha segue.
  const claimed = await db.maintenance.updateMany({
    where: { id: maintenanceId, status: 'scheduled' },
    data: { status: 'in_progress', startedAt: at },
  });
  if (claimed.count === 0) return false;

  for (const link of maintenance.components) {
    await db.maintenanceComponent.update({
      where: {
        maintenanceId_componentId: { maintenanceId, componentId: link.componentId },
      },
      data: { previousStatus: link.component.status },
    });
  }
  await setComponentStatuses(
    db,
    maintenance.components.map((c) => ({
      componentId: c.componentId,
      status: 'under_maintenance',
    })),
    { actorId: options.actorId, at },
  );
  await db.maintenanceUpdate.create({
    data: {
      maintenanceId,
      status: 'in_progress',
      body: options.body ?? '',
      notify: options.notify ?? true,
      createdById: options.actorId ?? null,
      createdAt: at,
    },
  });
  await recordAudit(db, {
    actorId: options.actorId,
    action: 'maintenance.start',
    entityType: 'maintenance',
    entityId: maintenanceId,
    pageId: maintenance.pageId,
    after: { status: 'in_progress', automatic: !options.actorId },
  });
  return true;
}

/**
 * Conclui a manutenção e restaura o status anterior dos componentes, exceto os
 * que mudaram de status durante a manutenção ou que seguem em outra manutenção
 * em andamento.
 */
export async function completeMaintenance(
  db: Db,
  maintenanceId: string,
  options: TransitionOptions = {},
): Promise<boolean> {
  const at = options.at ?? new Date();
  const maintenance = await db.maintenance.findUnique({
    where: { id: maintenanceId },
    include: { components: { include: { component: { select: { status: true } } } } },
  });
  if (!maintenance || maintenance.status === 'completed') return false;

  const claimed = await db.maintenance.updateMany({
    where: { id: maintenanceId, status: { not: 'completed' } },
    data: { status: 'completed', completedAt: at, startedAt: maintenance.startedAt ?? at },
  });
  if (claimed.count === 0) return false;

  const stillCovered = await db.maintenanceComponent.findMany({
    where: {
      componentId: { in: maintenance.components.map((c) => c.componentId) },
      maintenanceId: { not: maintenanceId },
      maintenance: { status: 'in_progress' },
    },
    select: { componentId: true },
  });
  const covered = new Set(stillCovered.map((c) => c.componentId));

  const restore = maintenance.components
    .filter((c) => c.component.status === 'under_maintenance' && !covered.has(c.componentId))
    .map((c) => ({
      componentId: c.componentId,
      status:
        c.previousStatus && c.previousStatus !== 'under_maintenance'
          ? c.previousStatus
          : ('operational' as const),
    }));
  await setComponentStatuses(db, restore, { actorId: options.actorId, at });

  await db.maintenanceUpdate.create({
    data: {
      maintenanceId,
      status: 'completed',
      body: options.body ?? '',
      notify: options.notify ?? true,
      createdById: options.actorId ?? null,
      createdAt: at,
    },
  });
  await recordAudit(db, {
    actorId: options.actorId,
    action: 'maintenance.complete',
    entityType: 'maintenance',
    entityId: maintenanceId,
    pageId: maintenance.pageId,
    after: { status: 'completed', automatic: !options.actorId },
  });
  return true;
}

export interface DueTransitions {
  started: string[];
  completed: string[];
}

/**
 * Aplica as transições automáticas vencidas até `now`. Cada manutenção é
 * processada em sua própria transação; uma falha não impede as demais.
 */
export async function runDueMaintenanceTransitions(
  prisma: PrismaClient,
  now = new Date(),
): Promise<DueTransitions> {
  const result: DueTransitions = { started: [], completed: [] };

  const toStart = await prisma.maintenance.findMany({
    where: { status: 'scheduled', autoStart: true, scheduledStart: { lte: now } },
    select: { id: true },
    orderBy: { scheduledStart: 'asc' },
  });
  // As transições usam o horário real (`now`), não o agendado: gravar no passado
  // poderia ficar atrás de mudanças de status já registradas no histórico.
  for (const { id } of toStart) {
    const started = await prisma.$transaction((tx) => startMaintenance(tx, id, { at: now }));
    if (started) result.started.push(id);
  }

  const toComplete = await prisma.maintenance.findMany({
    where: { status: 'in_progress', autoComplete: true, scheduledEnd: { lte: now } },
    select: { id: true },
    orderBy: { scheduledEnd: 'asc' },
  });
  for (const { id } of toComplete) {
    const completed = await prisma.$transaction((tx) => completeMaintenance(tx, id, { at: now }));
    if (completed) result.completed.push(id);
  }
  return result;
}
