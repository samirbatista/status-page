import { notFound } from 'next/navigation';
import { UsersManager } from '@/components/admin/users-manager';
import { getMe } from '@/lib/admin';
import { adminApi } from '@/lib/server-api';
import { type AdminUser } from '@/lib/types';

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const me = await getMe(locale);
  if (!me.isOwner) notFound();
  const users = await adminApi<AdminUser[]>('/users', locale);
  return (
    <div className="mx-auto max-w-4xl">
      <UsersManager users={users} pages={me.pages} currentUserId={me.id} />
    </div>
  );
}
