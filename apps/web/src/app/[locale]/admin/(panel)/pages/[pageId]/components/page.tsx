import { ComponentsManager } from '@/components/admin/components-manager';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type Structure } from '@/lib/types';

export default async function ComponentsPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  const role = pageRole(await getMe(locale), pageId);
  const structure = await adminApi<Structure>(`/pages/${pageId}/structure`, locale);
  return (
    <ComponentsManager
      pageId={pageId}
      structure={structure}
      canAdmin={can(role, 'admin')}
      canOperate={can(role, 'operator')}
    />
  );
}
