import { notFound } from 'next/navigation';
import { ThemeEditor } from '@/components/admin/theme-editor';
import { getPathname } from '@/i18n/navigation';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminPage, type ThemeState, type UploadInfo } from '@/lib/types';
import { isLocale } from '@status-page/shared';

export default async function AppearancePage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  if (!isLocale(locale)) notFound();
  if (!can(pageRole(await getMe(locale), pageId), 'admin')) notFound();
  const [page, theme, uploads] = await Promise.all([
    adminApi<AdminPage>(`/pages/${pageId}`, locale),
    adminApi<ThemeState>(`/pages/${pageId}/theme`, locale),
    adminApi<UploadInfo[]>(`/pages/${pageId}/uploads`, locale),
  ]);
  const previewPath = `${getPathname({ href: `/p/${page.slug}`, locale })}?preview=draft`;
  return (
    <ThemeEditor
      pageId={pageId}
      previewPath={previewPath}
      initial={theme}
      initialUploads={uploads}
    />
  );
}
