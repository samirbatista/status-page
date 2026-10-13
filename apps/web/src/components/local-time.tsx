'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';

type Style = 'datetime' | 'date' | 'time';

// Campos explícitos (e não dateStyle/timeStyle), que não podem ser combinados com timeZoneName.
const OPTIONS: Record<Style, Intl.DateTimeFormatOptions> = {
  datetime: {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  },
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  time: { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' },
};

/**
 * Exibe a data no fuso do visitante. No servidor renderiza no fuso da página
 * (`fallbackTimeZone`); após hidratar, troca para o fuso do navegador.
 */
export function LocalTime({
  value,
  style = 'datetime',
  fallbackTimeZone = 'UTC',
}: {
  value: string | Date;
  style?: Style;
  fallbackTimeZone?: string;
}) {
  const locale = useLocale();
  const [timeZone, setTimeZone] = useState(fallbackTimeZone);
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  const date = typeof value === 'string' ? new Date(value) : value;
  const text = new Intl.DateTimeFormat(locale, { ...OPTIONS[style], timeZone }).format(date);
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {text}
    </time>
  );
}
