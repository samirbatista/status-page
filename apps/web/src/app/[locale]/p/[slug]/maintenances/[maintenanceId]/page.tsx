import { isLocale } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { MaintenanceCard } from '@/components/public/status-page-view';
import { ThemedShell } from '@/components/public/themed-shell';
import { pageMetadata } from '@/lib/page-metadata';
import { publicApi } from '@/lib/server-api';
import { type PublicMaintenance, type PublicPage } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string; maintenanceId: string }>;
type Data = { page: PublicPage; maintenance: PublicMaintenance };

async function load(params: Params) {
  const { locale, slug, maintenanceId } = await params;
  return publicApi<Data>(
    `/public/pages/${encodeURIComponent(slug)}/maintenances/${encodeURIComponent(maintenanceId)}`,
    { locale, returnTo: `/p/${slug}/maintenances/${maintenanceId}` },
  );
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { page, maintenance } = await load(params);
  return pageMetadata(page, maintenance.title);
}

export default async function MaintenancePage({ params }: { params: Params }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const { page, maintenance } = await load(params);
  return (
    <ThemedShell page={page}>
      <MaintenanceCard maintenance={maintenance} slug={page.slug} timeZone={page.timezone} />
    </ThemedShell>
  );
}
