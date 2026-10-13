import { isLocale } from '@status-page/shared';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { LocalTime } from '@/components/local-time';
import { ThemedShell } from '@/components/public/themed-shell';
import { IncidentStatusBadge } from '@/components/status-badge';
import { Link } from '@/i18n/navigation';
import { publicApi } from '@/lib/server-api';
import { type PublicIncident, type PublicMaintenance, type PublicPage } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Data = {
  page: PublicPage;
  month: string;
  incidents: PublicIncident[];
  maintenances: PublicMaintenance[];
};

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const requested = (await searchParams).month;
  const month =
    requested && /^\d{4}-\d{2}$/.test(requested) ? requested : new Date().toISOString().slice(0, 7);
  const data = await publicApi<Data>(
    `/public/pages/${encodeURIComponent(slug)}/history?month=${month}`,
    { locale, returnTo: `/p/${slug}/history` },
  );
  const t = await getTranslations('history');
  const format = await getFormatter();
  const label = format.dateTime(new Date(`${month}-15T12:00:00Z`), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const current = new Date().toISOString().slice(0, 7);

  return (
    <ThemedShell page={data.page}>
      <div className="flex items-center justify-between">
        <Link
          href={`/p/${slug}/history?month=${shiftMonth(month, -1)}`}
          className="text-[var(--link)] hover:underline"
        >
          ← {t('previous')}
        </Link>
        <h1 className="text-xl font-semibold capitalize">{label}</h1>
        {month < current ? (
          <Link
            href={`/p/${slug}/history?month=${shiftMonth(month, 1)}`}
            className="text-[var(--link)] hover:underline"
          >
            {t('next')} →
          </Link>
        ) : (
          <span />
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t('incidents')}</h2>
        {data.incidents.length === 0 ? (
          <p className="text-[var(--muted)]">{t('noIncidents')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            {data.incidents.map((incident) => (
              <li
                key={incident.id}
                className="flex flex-wrap items-center justify-between gap-2 px-6 py-4"
              >
                <div>
                  <Link
                    href={`/p/${slug}/incidents/${incident.id}`}
                    className="font-medium hover:underline"
                  >
                    {incident.title}
                  </Link>
                  <p className="text-sm text-[var(--muted)]">
                    <LocalTime value={incident.startedAt} fallbackTimeZone={data.page.timezone} />
                  </p>
                </div>
                <IncidentStatusBadge status={incident.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t('maintenances')}</h2>
        {data.maintenances.length === 0 ? (
          <p className="text-[var(--muted)]">{t('noMaintenances')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            {data.maintenances.map((m) => (
              <li key={m.id} className="px-6 py-4">
                <Link
                  href={`/p/${slug}/maintenances/${m.id}`}
                  className="font-medium hover:underline"
                >
                  {m.title}
                </Link>
                <p className="text-sm text-[var(--muted)]">
                  <LocalTime value={m.scheduledStart} fallbackTimeZone={data.page.timezone} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ThemedShell>
  );
}
