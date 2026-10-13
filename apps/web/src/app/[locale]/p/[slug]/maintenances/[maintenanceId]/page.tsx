import { isLocale } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { MaintenanceCard, PublicShell } from '@/components/public/status-page-view';
import { publicApi } from '@/lib/server-api';
import { type PublicMaintenance, type PublicPage } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string; maintenanceId: string }>;
type Data = { page: PublicPage; maintenance: PublicMaintenance };

async function load(params: Params) {
  const { slug, maintenanceId } = await params;
  return publicApi<Data>(
    `/public/pages/${encodeURIComponent(slug)}/maintenances/${encodeURIComponent(maintenanceId)}`,
  );
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { page, maintenance } = await load(params);
  return { title: `${maintenance.title} · ${page.name}` };
}

export default async function MaintenancePage({ params }: { params: Params }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const { page, maintenance } = await load(params);
  return (
    <PublicShell page={page}>
      <MaintenanceCard maintenance={maintenance} slug={page.slug} timeZone={page.timezone} />
    </PublicShell>
  );
}
