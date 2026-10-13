'use client';

import { type ComponentStatus } from '@status-page/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { type DailyUptime } from '@/lib/types';
import { STATUS_BG } from '../status-badge';
import { cx } from '../ui/ui';

function barClass(day: DailyUptime): string {
  if (day.uptime === null || day.worstStatus === null) return 'bg-[var(--border)]';
  const color: ComponentStatus = day.worstStatus;
  return STATUS_BG[color];
}

/**
 * Barra de disponibilidade: um traço por dia. Em telas pequenas mostra só os
 * últimos 30 dias. O detalhe do dia aparece num único tooltip (ao passar o mouse
 * ou tocar), em vez de um por barra, para manter o HTML da página leve.
 */
export function UptimeBar({ days, uptime }: { days: DailyUptime[]; uptime: number | null }) {
  const t = useTranslations('uptime');
  const format = useFormatter();
  const [active, setActive] = useState<number | null>(null);
  const total = days.length;
  const percent = (value: number) =>
    format.number(value, { style: 'percent', maximumFractionDigits: 2 });
  const day = active === null ? null : days[active];

  return (
    <div className="relative mt-2" onMouseLeave={() => setActive(null)}>
      <div
        className="flex h-8 items-stretch gap-px"
        role="img"
        aria-label={t('aria', { days: total })}
      >
        {days.map((d, i) => (
          <div
            key={d.date}
            aria-hidden
            onMouseEnter={() => setActive(i)}
            onClick={() => setActive(active === i ? null : i)}
            className={cx(
              'flex-1 rounded-sm',
              barClass(d),
              active === i && 'opacity-70',
              i < total - 30 && 'hidden sm:block',
            )}
          />
        ))}
      </div>
      {day ? (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-2 w-52 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-xs shadow-lg"
          style={{
            left: `clamp(6.5rem, ${((active! + 0.5) / total) * 100}%, calc(100% - 6.5rem))`,
          }}
        >
          <p className="font-medium">
            {format.dateTime(new Date(`${day.date}T12:00:00Z`), {
              dateStyle: 'medium',
              timeZone: 'UTC',
            })}
          </p>
          {day.uptime === null ? (
            <p className="text-[var(--muted)]">{t('noData')}</p>
          ) : (
            <>
              <p>{t('dayUptime', { value: percent(day.uptime) })}</p>
              {day.majorOutageMinutes > 0 ? (
                <p className="text-status-major_outage">
                  {t('majorMinutes', { minutes: day.majorOutageMinutes })}
                </p>
              ) : null}
              {day.partialOutageMinutes > 0 ? (
                <p className="text-status-partial_outage">
                  {t('partialMinutes', { minutes: day.partialOutageMinutes })}
                </p>
              ) : null}
              {day.majorOutageMinutes === 0 && day.partialOutageMinutes === 0 ? (
                <p className="text-[var(--muted)]">{t('noDowntime')}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
        <span>
          <span className="sm:hidden">{t('daysAgo', { days: 30 })}</span>
          <span className="hidden sm:inline">{t('daysAgo', { days: total })}</span>
        </span>
        <span>{uptime === null ? t('noData') : t('uptimeValue', { value: percent(uptime) })}</span>
        <span>{t('today')}</span>
      </div>
    </div>
  );
}
