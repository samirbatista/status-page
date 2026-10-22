import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiTokensManager, EmbedSnippets } from '@/components/admin/developers';
import { Card } from '@/components/ui/ui';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminPage, type ApiToken } from '@/lib/types';

export default async function DevelopersPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  if (!can(pageRole(await getMe(locale), pageId), 'admin')) notFound();
  const [page, tokens] = await Promise.all([
    adminApi<AdminPage>(`/pages/${pageId}`, locale),
    adminApi<ApiToken[]>(`/pages/${pageId}/api-tokens`, locale),
  ]);
  const t = await getTranslations('admin.developers');
  return (
    <div className="grid gap-6">
      <Card title={t('tokensHeading')}>
        <ApiTokensManager pageId={pageId} tokens={tokens} />
      </Card>
      <Card title={t('embedHeading')}>
        <EmbedSnippets pageId={pageId} slug={page.slug} isPublic={page.visibility === 'public'} />
      </Card>
    </div>
  );
}
