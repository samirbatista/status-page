import { isLocale } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocalTime } from '@/components/local-time';
import { PublicShell } from '@/components/public/status-page-view';
import { Timeline, useIncidentTimeline } from '@/components/public/updates-timeline';
import { IncidentStatusBadge } from '@/components/status-badge';
import { publicApi } from '@/lib/server-api';
import { type PublicIncident, type PublicPage } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string; incidentId: string }>;
type Data = { page: PublicPage; incident: PublicIncident };

async function load(params: Params) {
  const { slug, incidentId } = await params;
  return publicApi<Data>(
    `/public/pages/${encodeURIComponent(slug)}/incidents/${encodeURIComponent(incidentId)}`,
  );
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { page, incident } = await load(params);
  return { title: `${incident.title} · ${page.name}` };
}

export default async function IncidentPage({ params }: { params: Params }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const { page, incident } = await load(params);
  const t = await getTranslations('incident');
  return (
    <PublicShell page={page}>
      <IncidentDetail
        incident={incident}
        timeZone={page.timezone}
        impactLabel={t(`impact.${incident.impact}`)}
      />
    </PublicShell>
  );
}

function IncidentDetail({
  incident,
  timeZone,
  impactLabel,
}: {
  incident: PublicIncident;
  timeZone: string;
  impactLabel: string;
}) {
  const timeline = useIncidentTimeline(incident.updates);
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{incident.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <IncidentStatusBadge status={incident.status} />
          {impactLabel} · <LocalTime value={incident.startedAt} fallbackTimeZone={timeZone} />
        </p>
      </header>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <Timeline items={timeline} timeZone={timeZone} />
      </div>
    </article>
  );
}
