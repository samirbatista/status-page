'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { type MetricSeries } from '@/lib/types';
import { cx } from './ui/ui';

/** Cor da disponibilidade de um intervalo (mesma escala da barra de uptime). */
function uptimeClass(uptime: number | null): string {
  if (uptime === null) return 'bg-[var(--border)]';
  if (uptime >= 99.9) return 'bg-status-operational';
  if (uptime >= 95) return 'bg-status-degraded_performance';
  if (uptime >= 80) return 'bg-status-partial_outage';
  return 'bg-status-major_outage';
}

/** Latência (área) e disponibilidade por intervalo (faixa colorida) de um monitor. */
export function MetricsChart({
  series,
  fallbackTimeZone = 'UTC',
}: {
  series: MetricSeries;
  fallbackTimeZone?: string;
}) {
  const t = useTranslations('metrics');
  const locale = useLocale();
  const [timeZone, setTimeZone] = useState(fallbackTimeZone);
  useEffect(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  const format = useMemo(() => {
    const short = new Intl.DateTimeFormat(
      locale,
      series.range === 'day'
        ? { hour: '2-digit', minute: '2-digit', timeZone }
        : { day: '2-digit', month: '2-digit', timeZone },
    );
    const long = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    });
    return { short: (v: number) => short.format(v), long: (v: number) => long.format(v) };
  }, [locale, series.range, timeZone]);

  const data = series.points.map((p) => ({
    at: new Date(p.at).getTime(),
    latency: p.latencyMs,
    uptime: p.uptime,
  }));

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-6 text-sm">
        <div>
          <dt className="text-[var(--muted)]">{t('uptime')}</dt>
          <dd className="text-lg font-semibold" data-testid="metric-uptime">
            {series.uptime === null ? '—' : `${series.uptime.toLocaleString(locale)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">{t('avgLatency')}</dt>
          <dd className="text-lg font-semibold">
            {series.avgLatencyMs === null ? '—' : `${series.avgLatencyMs} ms`}
          </dd>
        </div>
      </dl>
      {series.checks === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--muted)]">{t('noData')}</p>
      ) : (
        <>
          <div className="h-44 w-full" role="img" aria-label={t('latencyChart')}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="at"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={format.short}
                  tick={{ fontSize: 11, fill: 'var(--muted)' }}
                  stroke="var(--border)"
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--muted)' }}
                  stroke="var(--border)"
                  unit=" ms"
                  width={64}
                />
                <Tooltip
                  labelFormatter={(v) => format.long(Number(v))}
                  formatter={(value) => [`${value} ms`, t('latency')]}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke="var(--color-brand)"
                  fill="var(--color-brand)"
                  fillOpacity={0.15}
                  connectNulls
                  // Pontos ajudam quando há poucos intervalos com dados.
                  dot={{ r: 2, strokeWidth: 0, fill: 'var(--color-brand)' }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex h-6 gap-px" aria-label={t('uptimeBar')}>
            {data.map((p) => (
              <span
                key={p.at}
                title={`${format.long(p.at)} · ${p.uptime === null ? t('noData') : `${p.uptime}%`}`}
                className={cx('flex-1 rounded-sm', uptimeClass(p.uptime))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
