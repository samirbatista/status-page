import { type ComponentStatus, isLocale, type Locale, statusSeverity } from '@status-page/shared';
import { recordAudit } from './audit.js';
import { setComponentStatuses } from './component-status.js';
import { type Db } from './db.js';
import { recordComponentEvent, recordIncidentEvent } from './notification-events.js';

/**
 * Automação de status: monitores e webhooks de entrada geram "sinais" de falha
 * ou normalização. No modo automático o status do componente muda (e um
 * incidente pode ser aberto a partir de um template); no modo sugestão, um
 * alerta aguarda o operador. A normalização restaura o status anterior.
 */

export interface Signal {
  /** Chave estável da origem: `monitor:<id>` ou `inbound:<origem>:<alerta>:<componente>`. */
  key: string;
  pageId: string;
  componentId: string;
  /** Em falha (true) ou normalizado (false). */
  failing: boolean;
  /** Status aplicado na falha. */
  status: ComponentStatus;
  title: string;
  detail?: string | null;
  mode: 'auto' | 'suggest';
  templateId?: string | null;
  source: 'monitor' | 'inbound';
}

export type SignalOutcome =
  | 'applied'
  | 'incident_opened'
  | 'already_applied'
  | 'restored'
  | 'incident_resolved'
  | 'suggested'
  | 'suggestion_updated'
  | 'suggestion_closed'
  | 'recovery_suggested'
  | 'noop';

const RECOVERY_TEXT: Record<Locale, string> = {
  'pt-BR': 'O serviço voltou a operar normalmente (detectado automaticamente).',
  'en-US': 'The service is operating normally again (detected automatically).',
  es: 'El servicio volvió a operar con normalidad (detectado automáticamente).',
};
const FAILURE_TEXT: Record<Locale, string> = {
  'pt-BR': 'Falha detectada automaticamente: {title}.',
  'en-US': 'Failure detected automatically: {title}.',
  es: 'Falla detectada automáticamente: {title}.',
};

async function pageLocale(db: Db, pageId: string): Promise<Locale> {
  const page = await db.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { defaultLocale: true },
  });
  return isLocale(page.defaultLocale) ? page.defaultLocale : 'pt-BR';
}

function worst(statuses: ComponentStatus[]): ComponentStatus {
  return statuses.reduce<ComponentStatus>(
    (acc, s) => (statusSeverity(s) > statusSeverity(acc) ? s : acc),
    'operational',
  );
}

/**
 * Abre um incidente a partir do template: o componente do sinal entra com o
 * status de falha; os demais componentes do template, com o status do template.
 */
export async function openIncidentFromTemplate(
  db: Db,
  input: {
    pageId: string;
    templateId: string;
    componentId: string;
    status: ComponentStatus;
    actorId?: string | null;
    source: string;
    at?: Date;
  },
): Promise<string | null> {
  const template = await db.incidentTemplate.findFirst({
    where: { id: input.templateId, pageId: input.pageId },
  });
  if (!template) return null;
  const at = input.at ?? new Date();
  const components = new Map<string, ComponentStatus>();
  for (const id of template.componentIds) {
    components.set(id, template.componentStatus ?? input.status);
  }
  components.set(input.componentId, input.status);
  const changes = [...components].map(([componentId, status]) => ({ componentId, status }));
  const incident = await db.incident.create({
    data: {
      pageId: input.pageId,
      title: template.title,
      status: template.status === 'resolved' ? 'investigating' : template.status,
      impact: template.impact,
      startedAt: at,
      createdById: input.actorId ?? null,
      updates: {
        create: {
          status: template.status === 'resolved' ? 'investigating' : template.status,
          body: template.body,
          notify: true,
          displayAt: at,
          createdById: input.actorId ?? null,
          components: { create: changes },
        },
      },
    },
  });
  await setComponentStatuses(db, changes, { actorId: input.actorId, at });
  await recordIncidentEvent(db, incident.id, 'incident_created');
  await recordAudit(db, {
    actorId: input.actorId ?? null,
    action: 'incident.create',
    entityType: 'incident',
    entityId: incident.id,
    pageId: input.pageId,
    after: { title: incident.title, automatic: !input.actorId, source: input.source },
  });
  return incident.id;
}

/** Aplica a falha (modo automático ou sugestão aceita). */
async function applyFailure(
  db: Db,
  signal: Signal,
  options: { actorId?: string | null; openIncident: boolean },
): Promise<SignalOutcome> {
  const existing = await db.automationState.findUnique({ where: { key: signal.key } });
  if (existing) return 'already_applied';
  const component = await db.component.findUniqueOrThrow({
    where: { id: signal.componentId },
    select: { status: true },
  });
  // Outra falha já ativa no componente guarda o status "de antes" verdadeiro.
  const other = await db.automationState.findFirst({
    where: { componentId: signal.componentId },
    orderBy: { startedAt: 'asc' },
  });
  const previousStatus = other?.previousStatus ?? component.status;

  let incidentId: string | null = null;
  if (options.openIncident && signal.templateId) {
    incidentId = await openIncidentFromTemplate(db, {
      pageId: signal.pageId,
      templateId: signal.templateId,
      componentId: signal.componentId,
      status: signal.status,
      actorId: options.actorId,
      source: signal.source,
    });
  }
  if (!incidentId) {
    // Nunca melhora o status: só piora (a falha não esconde algo mais grave).
    if (statusSeverity(signal.status) > statusSeverity(component.status)) {
      const applied = await setComponentStatuses(
        db,
        [{ componentId: signal.componentId, status: signal.status }],
        { actorId: options.actorId },
      );
      if (applied.length > 0) {
        const locale = await pageLocale(db, signal.pageId);
        await recordComponentEvent(
          db,
          signal.pageId,
          signal.componentId,
          FAILURE_TEXT[locale].replace('{title}', signal.title),
        );
      }
    }
  }
  await db.automationState.create({
    data: {
      key: signal.key,
      pageId: signal.pageId,
      componentId: signal.componentId,
      appliedStatus: signal.status,
      previousStatus,
      incidentId,
      title: signal.title,
    },
  });
  await recordAudit(db, {
    actorId: options.actorId ?? null,
    action: 'automation.failure',
    entityType: 'component',
    entityId: signal.componentId,
    pageId: signal.pageId,
    after: { key: signal.key, status: signal.status, title: signal.title, incidentId },
  });
  return incidentId ? 'incident_opened' : 'applied';
}

/**
 * Normaliza: volta o componente ao status anterior (se ninguém mexeu nele
 * desde a falha e não houver outra falha ativa) e resolve o incidente aberto
 * pela automação.
 */
async function applyRecovery(
  db: Db,
  signal: Pick<Signal, 'key' | 'pageId' | 'componentId'>,
  options: { actorId?: string | null },
): Promise<SignalOutcome> {
  const state = await db.automationState.findUnique({ where: { key: signal.key } });
  if (!state) return 'noop';
  await db.automationState.delete({ where: { id: state.id } });
  const others = await db.automationState.findMany({ where: { componentId: state.componentId } });
  const target =
    others.length > 0 ? worst(others.map((o) => o.appliedStatus)) : state.previousStatus;
  const component = await db.component.findUniqueOrThrow({
    where: { id: state.componentId },
    select: { status: true },
  });
  const untouched = component.status === state.appliedStatus;
  const locale = await pageLocale(db, state.pageId);
  const body = RECOVERY_TEXT[locale];

  let outcome: SignalOutcome = 'restored';
  const incident = state.incidentId
    ? await db.incident.findUnique({ where: { id: state.incidentId } })
    : null;
  if (incident && incident.status !== 'resolved') {
    const now = new Date();
    const changes = untouched ? [{ componentId: state.componentId, status: target }] : [];
    const update = await db.incidentUpdate.create({
      data: {
        incidentId: incident.id,
        status: 'resolved',
        body,
        notify: true,
        displayAt: now,
        createdById: options.actorId ?? null,
        components: { create: changes },
      },
    });
    await db.incident.update({
      where: { id: incident.id },
      data: { status: 'resolved', resolvedAt: now },
    });
    await setComponentStatuses(db, changes, { actorId: options.actorId, at: now });
    await recordIncidentEvent(db, incident.id, 'incident_resolved', update.id);
    outcome = 'incident_resolved';
  } else if (untouched) {
    const applied = await setComponentStatuses(
      db,
      [{ componentId: state.componentId, status: target }],
      { actorId: options.actorId },
    );
    if (applied.length > 0) {
      await recordComponentEvent(db, state.pageId, state.componentId, body);
    }
  }
  await recordAudit(db, {
    actorId: options.actorId ?? null,
    action: 'automation.recovery',
    entityType: 'component',
    entityId: state.componentId,
    pageId: state.pageId,
    after: { key: signal.key, status: untouched ? target : component.status, untouched },
  });
  return outcome;
}

/** Processa um sinal de falha ou normalização. Rode dentro de uma transação. */
export async function applySignal(db: Db, signal: Signal): Promise<SignalOutcome> {
  if (signal.mode === 'auto') {
    return signal.failing
      ? applyFailure(db, signal, { openIncident: true })
      : applyRecovery(db, signal, {});
  }

  // --- Modo sugestão ---
  const open = await db.alert.findFirst({
    where: { key: signal.key, state: 'open' },
    orderBy: { createdAt: 'desc' },
  });
  if (signal.failing) {
    if (open?.kind === 'failure') {
      await db.alert.update({
        where: { id: open.id },
        data: { occurrences: { increment: 1 }, lastSeenAt: new Date(), detail: signal.detail },
      });
      return 'suggestion_updated';
    }
    if (open?.kind === 'recovery') {
      // Caiu de novo antes de alguém aceitar a normalização: a sugestão perde o sentido.
      await db.alert.update({
        where: { id: open.id },
        data: { state: 'resolved', handledAt: new Date() },
      });
    }
    if (await db.automationState.findUnique({ where: { key: signal.key } })) {
      return 'already_applied';
    }
    await db.alert.create({
      data: {
        pageId: signal.pageId,
        componentId: signal.componentId,
        key: signal.key,
        kind: 'failure',
        suggestedStatus: signal.status,
        title: signal.title,
        detail: signal.detail,
        source: signal.source,
        templateId: signal.templateId ?? null,
      },
    });
    return 'suggested';
  }

  // Normalizou: sugestão de falha ainda aberta é fechada sozinha.
  if (open?.kind === 'failure') {
    await db.alert.update({
      where: { id: open.id },
      data: { state: 'resolved', handledAt: new Date() },
    });
    return 'suggestion_closed';
  }
  const state = await db.automationState.findUnique({ where: { key: signal.key } });
  if (!state || open?.kind === 'recovery') return 'noop';
  await db.alert.create({
    data: {
      pageId: signal.pageId,
      componentId: signal.componentId,
      key: signal.key,
      kind: 'recovery',
      suggestedStatus: state.previousStatus,
      title: signal.title,
      detail: signal.detail,
      source: signal.source,
    },
  });
  return 'recovery_suggested';
}

/** Operador aceita a sugestão: aplica a falha (e o incidente) ou a normalização. */
export async function acceptAlert(
  db: Db,
  alertId: string,
  options: { actorId: string; openIncident: boolean },
): Promise<SignalOutcome> {
  const alert = await db.alert.findUniqueOrThrow({ where: { id: alertId } });
  if (alert.state !== 'open') return 'noop';
  await db.alert.update({
    where: { id: alertId },
    data: { state: 'accepted', handledAt: new Date(), handledById: options.actorId },
  });
  if (alert.kind === 'recovery') {
    return applyRecovery(db, alert, { actorId: options.actorId });
  }
  return applyFailure(
    db,
    {
      key: alert.key,
      pageId: alert.pageId,
      componentId: alert.componentId,
      failing: true,
      status: alert.suggestedStatus,
      title: alert.title,
      detail: alert.detail,
      mode: 'suggest',
      templateId: alert.templateId,
      source: alert.source === 'monitor' ? 'monitor' : 'inbound',
    },
    { actorId: options.actorId, openIncident: options.openIncident },
  );
}

export async function dismissAlert(db: Db, alertId: string, actorId: string): Promise<void> {
  await db.alert.updateMany({
    where: { id: alertId, state: 'open' },
    data: { state: 'dismissed', handledAt: new Date(), handledById: actorId },
  });
}

/**
 * Monitor ou origem removida, desativada ou religada a outro componente:
 * normaliza o que ela tinha aplicado e fecha as sugestões abertas.
 */
export async function releaseSignals(
  db: Db,
  keyPrefix: string,
  actorId?: string | null,
): Promise<number> {
  await db.alert.updateMany({
    where: { key: { startsWith: keyPrefix }, state: 'open' },
    data: { state: 'resolved', handledAt: new Date() },
  });
  const states = await db.automationState.findMany({
    where: { key: { startsWith: keyPrefix } },
  });
  for (const state of states) await applyRecovery(db, state, { actorId });
  return states.length;
}

/** Remove os resultados de checagem mais antigos que o período das métricas públicas. */
export async function purgeMonitorResults(db: Db, days = 31): Promise<number> {
  const { count } = await db.monitorCheckResult.deleteMany({
    where: { checkedAt: { lt: new Date(Date.now() - days * 86_400_000) } },
  });
  return count;
}
