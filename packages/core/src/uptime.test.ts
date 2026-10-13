import { describe, expect, it } from 'vitest';
import { localDate, startOfLocalDay } from './time-zone.js';
import { computeUptime } from './uptime.js';

const TZ = 'America/Sao_Paulo'; // UTC-3, sem horário de verão desde 2019
const at = (iso: string) => new Date(iso);

describe('time zone helpers', () => {
  it('calcula a meia-noite local em UTC', () => {
    expect(startOfLocalDay('2026-10-10', TZ).toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(startOfLocalDay('2026-10-10', 'UTC').toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('trata dias com mudança de horário de verão', () => {
    // Nova York: horário de verão começa em 2026-03-08 às 02:00 locais.
    expect(startOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(startOfLocalDay('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });

  it('obtém a data local', () => {
    expect(localDate(at('2026-10-11T02:00:00Z'), TZ)).toBe('2026-10-10');
  });
});

describe('computeUptime', () => {
  const now = at('2026-10-10T15:00:00Z'); // 12:00 local

  it('dias anteriores ao primeiro registro ficam sem dados', () => {
    const { days, uptime } = computeUptime({
      history: [{ status: 'operational', changedAt: at('2026-10-09T03:00:00Z') }],
      days: 3,
      timeZone: TZ,
      now,
    });
    expect(days.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
    expect(days[0]).toMatchObject({ uptime: null, worstStatus: null });
    expect(days[1]).toMatchObject({ uptime: 1, worstStatus: 'operational' });
    expect(uptime).toBe(1);
  });

  it('pondera interrupção total como 100% e parcial como 30%', () => {
    const { days } = computeUptime({
      history: [
        { status: 'operational', changedAt: at('2026-10-01T00:00:00Z') },
        // 2026-10-09 local: 6h de interrupção total e 10h de parcial.
        { status: 'major_outage', changedAt: at('2026-10-09T03:00:00Z') },
        { status: 'partial_outage', changedAt: at('2026-10-09T09:00:00Z') },
        { status: 'operational', changedAt: at('2026-10-09T19:00:00Z') },
      ],
      days: 2,
      timeZone: TZ,
      now,
    });
    const expected = 1 - (6 * 60 + 10 * 60 * 0.3) / (24 * 60);
    expect(days[0]!.uptime).toBeCloseTo(expected, 6);
    expect(days[0]).toMatchObject({
      worstStatus: 'major_outage',
      majorOutageMinutes: 360,
      partialOutageMinutes: 600,
    });
    expect(days[1]).toMatchObject({ uptime: 1, worstStatus: 'operational' });
  });

  it('manutenção não conta como indisponibilidade', () => {
    const { days } = computeUptime({
      history: [
        { status: 'operational', changedAt: at('2026-10-01T00:00:00Z') },
        { status: 'under_maintenance', changedAt: at('2026-10-10T04:00:00Z') },
      ],
      days: 1,
      timeZone: TZ,
      now,
    });
    expect(days[0]).toMatchObject({ uptime: 1, worstStatus: 'under_maintenance' });
  });

  it('considera o dia de hoje só até o instante atual', () => {
    const { days } = computeUptime({
      history: [
        { status: 'operational', changedAt: at('2026-10-01T00:00:00Z') },
        { status: 'major_outage', changedAt: at('2026-10-10T09:00:00Z') }, // 06:00 local
      ],
      days: 1,
      timeZone: TZ,
      now,
    });
    // 12h decorridas no dia, 6h em interrupção total.
    expect(days[0]!.uptime).toBeCloseTo(0.5, 6);
  });
});
