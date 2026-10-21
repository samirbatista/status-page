import { applySignal, type SignalOutcome } from './automation.js';
import { type CheckResult, runCheck } from './checks.js';
import { type SecretBox } from './secret-box.js';
import { type Monitor, type PrismaClient } from '@status-page/db';
import { type MonitorType } from '@status-page/shared';

/**
 * Agendador das checagens. Cada monitor tem `nextCheckAt`; quem consegue
 * avançá-lo (update condicional) roda a checagem, então várias réplicas do
 * serviço não checam o mesmo monitor duas vezes.
 */

export interface Transition {
  monitorId: string;
  to: 'up' | 'down';
  outcome: SignalOutcome | null;
}

/** Novo estado e contadores depois de um resultado. */
export function nextState(
  monitor: Pick<
    Monitor,
    | 'state'
    | 'consecutiveFailures'
    | 'consecutiveSuccesses'
    | 'failureThreshold'
    | 'recoveryThreshold'
  >,
  ok: boolean,
): {
  state: Monitor['state'];
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  transition: 'up' | 'down' | null;
} {
  const failures = ok ? 0 : monitor.consecutiveFailures + 1;
  const successes = ok ? monitor.consecutiveSuccesses + 1 : 0;
  let state = monitor.state;
  let transition: 'up' | 'down' | null = null;
  if (!ok && state !== 'down' && failures >= monitor.failureThreshold) {
    state = 'down';
    transition = 'down';
  } else if (ok && state === 'down' && successes >= monitor.recoveryThreshold) {
    state = 'up';
    transition = 'up';
  } else if (ok && state === 'unknown') {
    // Primeira checagem boa: só registra que está no ar (nada a normalizar).
    state = 'up';
  }
  return { state, consecutiveFailures: failures, consecutiveSuccesses: successes, transition };
}

export async function checkMonitor(
  prisma: PrismaClient,
  secrets: SecretBox,
  monitor: Monitor,
): Promise<{ result: CheckResult; transition: Transition | null }> {
  const headers = monitor.headersEnc
    ? (JSON.parse(secrets.decrypt(monitor.headersEnc)) as Record<string, string>)
    : undefined;
  const result = await runCheck({
    type: monitor.type as MonitorType,
    target: monitor.target,
    config: (monitor.config ?? {}) as Record<string, unknown>,
    headers,
    timeoutMs: monitor.timeoutMs,
  });
  const next = nextState(monitor, result.ok);
  const now = new Date();

  const transition = await prisma.$transaction(async (tx) => {
    await tx.monitorCheckResult.create({
      data: {
        monitorId: monitor.id,
        checkedAt: now,
        ok: result.ok,
        latencyMs: result.latencyMs,
        error: result.error,
      },
    });
    await tx.monitor.update({
      where: { id: monitor.id },
      data: {
        state: next.state,
        consecutiveFailures: next.consecutiveFailures,
        consecutiveSuccesses: next.consecutiveSuccesses,
        lastCheckAt: now,
        lastLatencyMs: result.latencyMs,
        lastError: result.error,
      },
    });
    if (!next.transition) return null;
    let outcome: SignalOutcome | null = null;
    if (monitor.componentId) {
      outcome = await applySignal(tx, {
        key: `monitor:${monitor.id}`,
        pageId: monitor.pageId,
        componentId: monitor.componentId,
        failing: next.transition === 'down',
        status: monitor.failureStatus,
        title: monitor.name,
        detail: result.error,
        mode: monitor.mode,
        templateId: monitor.templateId,
        source: 'monitor',
      });
    }
    return { monitorId: monitor.id, to: next.transition, outcome };
  });
  return { result, transition };
}

/** Executa as tarefas com no máximo `limit` ao mesmo tempo. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  });
  await Promise.all(workers);
}

/**
 * Reivindica os monitores vencidos e roda as checagens. Retorna as mudanças de
 * estado (para enfileirar as notificações) e quantos foram checados.
 */
export async function runDueChecks(
  prisma: PrismaClient,
  secrets: SecretBox,
  options: {
    now?: Date;
    batch?: number;
    concurrency?: number;
    onError?: (id: string, e: unknown) => void;
  } = {},
): Promise<{ checked: number; transitions: Transition[] }> {
  const now = options.now ?? new Date();
  const due = await prisma.monitor.findMany({
    where: { enabled: true, nextCheckAt: { lte: now } },
    orderBy: { nextCheckAt: 'asc' },
    take: options.batch ?? 200,
  });
  const claimed: Monitor[] = [];
  for (const monitor of due) {
    const { count } = await prisma.monitor.updateMany({
      where: { id: monitor.id, nextCheckAt: monitor.nextCheckAt },
      data: { nextCheckAt: new Date(now.getTime() + monitor.intervalSeconds * 1000) },
    });
    if (count === 1) claimed.push(monitor);
  }
  const transitions: Transition[] = [];
  await pool(claimed, options.concurrency ?? 20, async (monitor) => {
    try {
      const { transition } = await checkMonitor(prisma, secrets, monitor);
      if (transition) transitions.push(transition);
    } catch (error) {
      options.onError?.(monitor.id, error);
    }
  });
  return { checked: claimed.length, transitions };
}
