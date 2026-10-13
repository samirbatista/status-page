import { type ComponentStatus } from '@status-page/shared';
import { addDays, localDate, startOfLocalDay } from './time-zone.js';

/**
 * Peso de indisponibilidade de cada status (0 = disponível, 1 = indisponível).
 * Manutenção programada e desempenho degradado não contam como indisponibilidade.
 */
export type DowntimeWeights = Record<ComponentStatus, number>;

export const DEFAULT_DOWNTIME_WEIGHTS: DowntimeWeights = {
  operational: 0,
  under_maintenance: 0,
  degraded_performance: 0,
  partial_outage: 0.3,
  major_outage: 1,
};

export interface StatusPoint {
  status: ComponentStatus;
  changedAt: Date;
}

export interface DailyUptime {
  /** Data local no fuso da página (`YYYY-MM-DD`). */
  date: string;
  /** Fração de 0 a 1; `null` quando não há dados (componente ainda não existia). */
  uptime: number | null;
  /** Pior status registrado no dia, para colorir a barra. */
  worstStatus: ComponentStatus | null;
  /** Minutos em interrupção parcial e total no dia. */
  partialOutageMinutes: number;
  majorOutageMinutes: number;
}

export interface UptimeResult {
  days: DailyUptime[];
  /** Uptime ponderado de todo o período; `null` sem dados. */
  uptime: number | null;
}

const SEVERITY: ComponentStatus[] = [
  'operational',
  'under_maintenance',
  'degraded_performance',
  'partial_outage',
  'major_outage',
];

/**
 * Calcula o uptime diário dos últimos `days` dias (incluindo hoje) a partir do
 * histórico de mudanças de status de um componente.
 */
export function computeUptime(params: {
  history: StatusPoint[];
  days: number;
  timeZone: string;
  now?: Date;
  weights?: DowntimeWeights;
}): UptimeResult {
  const now = params.now ?? new Date();
  const weights = params.weights ?? DEFAULT_DOWNTIME_WEIGHTS;
  const history = [...params.history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());

  const today = localDate(now, params.timeZone);
  const firstDay = addDays(today, -(params.days - 1));

  const result: DailyUptime[] = [];
  let totalKnown = 0;
  let totalDown = 0;
  let index = 0;
  let current: ComponentStatus | null = null;

  for (let i = 0; i < params.days; i++) {
    const date = addDays(firstDay, i);
    const dayStart = startOfLocalDay(date, params.timeZone).getTime();
    const dayEnd = Math.min(
      startOfLocalDay(addDays(date, 1), params.timeZone).getTime(),
      now.getTime(),
    );

    // Avança até o status vigente no início do dia.
    while (index < history.length && history[index]!.changedAt.getTime() <= dayStart) {
      current = history[index]!.status;
      index++;
    }

    let cursor = dayStart;
    let status: ComponentStatus | null = current;
    let known = 0;
    let down = 0;
    let partial = 0;
    let major = 0;
    let worst: ComponentStatus | null = status;

    const accumulate = (until: number) => {
      const span = Math.max(0, until - cursor);
      if (status !== null && span > 0) {
        known += span;
        down += span * weights[status];
        if (status === 'partial_outage') partial += span;
        if (status === 'major_outage') major += span;
      }
      cursor = until;
    };

    while (index < history.length && history[index]!.changedAt.getTime() < dayEnd) {
      const point = history[index]!;
      accumulate(point.changedAt.getTime());
      status = point.status;
      if (worst === null || SEVERITY.indexOf(status) > SEVERITY.indexOf(worst)) worst = status;
      index++;
    }
    accumulate(dayEnd);
    current = status;

    totalKnown += known;
    totalDown += down;
    result.push({
      date,
      uptime: known > 0 ? 1 - down / known : null,
      worstStatus: known > 0 ? worst : null,
      partialOutageMinutes: Math.round(partial / 60_000),
      majorOutageMinutes: Math.round(major / 60_000),
    });
  }

  return { days: result, uptime: totalKnown > 0 ? 1 - totalDown / totalKnown : null };
}
