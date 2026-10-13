import { isLocale } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { StatusPageView } from '@/components/public/status-page-view';
import { publicApi } from '@/lib/server-api';
import { type PublicSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const summary = await publicApi<PublicSummary>(`/public/pages/${encodeURIComponent(slug)}`);
  return { title: summary.page.name, description: summary.page.description ?? undefined };
}

export default async function StatusPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const summary = await publicApi<PublicSummary>(`/public/pages/${encodeURIComponent(slug)}`);
  return <StatusPageView summary={summary} />;
}
