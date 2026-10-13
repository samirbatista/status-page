import { isLocale } from '@status-page/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { StatusPageView } from '@/components/public/status-page-view';
import { pageMetadata } from '@/lib/page-metadata';
import { publicApi } from '@/lib/server-api';
import { type PublicSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string }>;
type Search = Promise<{ preview?: string }>;

async function load(params: Params, searchParams: Search) {
  const { locale, slug } = await params;
  const preview = (await searchParams).preview === 'draft' ? '?preview=draft' : '';
  return publicApi<PublicSummary>(`/public/pages/${encodeURIComponent(slug)}${preview}`, {
    locale,
    returnTo: `/p/${slug}`,
  });
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  return pageMetadata((await load(params, searchParams)).page);
}

export default async function StatusPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return <StatusPageView summary={await load(params, searchParams)} />;
}
