import { type Db } from '@status-page/core';
import { Prisma } from '@status-page/db';
import { type MetricRange } from '@status-page/shared';

/** Período e tamanho do intervalo de cada faixa das métricas. */
export const RANGE_SPEC: Record<MetricRange, { hours: number; bucketMinutes: number }> = {
  day: { hours: 24, bucketMinutes: 30 },
  week: { hours: 24 * 7, bucketMinutes: 180 },
  month: { hours: 24 * 30, bucketMinutes: 720 },
};

export interface MetricPoint {
  /** Início do intervalo. */
  at: Date;
  /** Latência média (ms) das checagens com sucesso. */
  latencyMs: number | null;
  /** Disponibilidade no intervalo (0–100). */
  uptime: number | null;
}

export interface MetricSeries {
  range: MetricRange;
  from: Date;
  to: Date;
  bucketMinutes: number;
  /** Disponibilidade e latência média no período inteiro. */
  uptime: number | null;
  avgLatencyMs: number | null;
  checks: number;
  points: MetricPoint[];
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Agrega os resultados das checagens em intervalos fixos (calculado na
 * consulta; os resultados ficam guardados por 31 dias).
 */
export async function metricSeries(
  db: Db,
  monitorIds: string[],
  range: MetricRange,
  now = new Date(),
): Promise<Map<string, MetricSeries>> {
  const spec = RANGE_SPEC[range];
  const bucketMs = spec.bucketMinutes * 60_000;
  // Alinha o fim ao intervalo para que os pontos não "andem" a cada requisição.
  const to = new Date(Math.ceil(now.getTime() / bucketMs) * bucketMs);
  const from = new Date(to.getTime() - spec.hours * 3_600_000);
  const result = new Map<string, MetricSeries>();
  if (monitorIds.length === 0) return result;

  const rows = await db.$queryRaw<
    { monitor_id: string; bucket: Date; checks: bigint; ok: bigint; latency: number | null }[]
  >(Prisma.sql`
    SELECT monitor_id,
           date_bin(${`${spec.bucketMinutes} minutes`}::interval, checked_at, ${from}) AS bucket,
           count(*) AS checks,
           count(*) FILTER (WHERE ok) AS ok,
           avg(latency_ms) FILTER (WHERE ok) AS latency
    FROM monitor_check_results
    WHERE monitor_id = ANY(${monitorIds}::uuid[]) AND checked_at >= ${from} AND checked_at < ${to}
    GROUP BY 1, 2
  `);

  const buckets = Math.round((to.getTime() - from.getTime()) / bucketMs);
  for (const id of monitorIds) {
    const own = new Map(
      rows.filter((r) => r.monitor_id === id).map((r) => [new Date(r.bucket).getTime(), r]),
    );
    let checks = 0;
    let ok = 0;
    let latencySum = 0;
    let latencyN = 0;
    const points: MetricPoint[] = [];
    for (let i = 0; i < buckets; i++) {
      const at = new Date(from.getTime() + i * bucketMs);
      const row = own.get(at.getTime());
      if (!row) {
        points.push({ at, latencyMs: null, uptime: null });
        continue;
      }
      const c = Number(row.checks);
      const o = Number(row.ok);
      checks += c;
      ok += o;
      if (row.latency !== null) {
        latencySum += Number(row.latency) * o;
        latencyN += o;
      }
      points.push({
        at,
        latencyMs: row.latency === null ? null : Math.round(Number(row.latency)),
        uptime: round((o / c) * 100),
      });
    }
    result.set(id, {
      range,
      from,
      to,
      bucketMinutes: spec.bucketMinutes,
      uptime: checks ? round((ok / checks) * 100, 3) : null,
      avgLatencyMs: latencyN ? Math.round(latencySum / latencyN) : null,
      checks,
      points,
    });
  }
  return result;
}
