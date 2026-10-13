import { type ComponentStatus } from '@status-page/shared';
import { type Db } from './db.js';

export interface StatusChange {
  componentId: string;
  status: ComponentStatus;
}

export interface AppliedChange extends StatusChange {
  previous: ComponentStatus;
}

/**
 * Altera o status atual dos componentes e registra cada mudança no histórico
 * (base do cálculo de uptime). Componentes que já estão no status pedido são
 * ignorados.
 */
export async function setComponentStatuses(
  db: Db,
  changes: StatusChange[],
  options: { actorId?: string | null; at?: Date } = {},
): Promise<AppliedChange[]> {
  if (changes.length === 0) return [];
  const at = options.at ?? new Date();
  const current = await db.component.findMany({
    where: { id: { in: changes.map((c) => c.componentId) } },
    select: { id: true, status: true },
  });
  const byId = new Map(current.map((c) => [c.id, c.status]));

  const applied: AppliedChange[] = [];
  for (const change of changes) {
    const previous = byId.get(change.componentId);
    if (previous === undefined || previous === change.status) continue;
    await db.component.update({
      where: { id: change.componentId },
      data: { status: change.status },
    });
    await db.componentStatusHistory.create({
      data: {
        componentId: change.componentId,
        status: change.status,
        changedAt: at,
        changedById: options.actorId ?? null,
      },
    });
    byId.set(change.componentId, change.status);
    applied.push({ ...change, previous });
  }
  return applied;
}

/**
 * Registra no histórico um período passado (incidente retroativo) sem mexer no
 * status atual: grava `status` em `from` e, em `to`, volta ao status que estava
 * em vigor naquele momento. Mudanças reais já registradas dentro do intervalo
 * prevalecem a partir de quando ocorreram.
 */
export async function backfillComponentStatus(
  db: Db,
  componentId: string,
  status: ComponentStatus,
  from: Date,
  to: Date,
  actorId?: string | null,
): Promise<void> {
  const effectiveAtEnd = await db.componentStatusHistory.findFirst({
    where: { componentId, changedAt: { lte: to } },
    orderBy: { changedAt: 'desc' },
    select: { status: true },
  });
  await db.componentStatusHistory.createMany({
    data: [
      { componentId, status, changedAt: from, changedById: actorId ?? null },
      {
        componentId,
        status: effectiveAtEnd?.status ?? 'operational',
        changedAt: to,
        changedById: actorId ?? null,
      },
    ],
  });
}
