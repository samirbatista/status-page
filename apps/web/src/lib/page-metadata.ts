import { uploadUrl } from '@status-page/shared';
import type { Metadata } from 'next';
import { type PublicPage } from './types';

/** Título, favicon e imagem de compartilhamento a partir do tema da página. */
export function pageMetadata(page: PublicPage, title?: string): Metadata {
  const { theme } = page;
  return {
    title: title ? `${title} · ${page.name}` : page.name,
    description: page.description ?? undefined,
    icons: theme.faviconId ? { icon: uploadUrl(theme.faviconId) } : undefined,
    openGraph: {
      title: title ?? page.name,
      description: page.description ?? undefined,
      images: theme.ogImageId ? [uploadUrl(theme.ogImageId)] : undefined,
    },
    // Páginas privadas e pré-visualizações não devem ser indexadas.
    robots:
      page.visibility === 'private' || page.preview ? { index: false, follow: false } : undefined,
  };
}
