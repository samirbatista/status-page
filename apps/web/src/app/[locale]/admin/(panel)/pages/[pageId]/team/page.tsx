import { notFound } from 'next/navigation';
import { TeamManager } from '@/components/admin/team-manager';
import { can, getMe, pageRole } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type TeamMember } from '@/lib/types';

export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string; pageId: string }>;
}) {
  const { locale, pageId } = await params;
  if (!can(pageRole(await getMe(locale), pageId), 'admin')) notFound();
  const team = await adminApi<TeamMember[]>(`/pages/${pageId}/team`, locale);
  return <TeamManager pageId={pageId} team={team} />;
}
