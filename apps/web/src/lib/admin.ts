import 'server-only';
import { roleAtLeast, type Role } from '@status-page/shared';
import { notFound } from 'next/navigation';
import { adminApi } from './server-api';
import { type Me } from './types';

export async function getMe(locale: string): Promise<Me> {
  return adminApi<Me>('/auth/me', locale);
}

/** Papel do usuário na página; 404 se não tiver acesso. */
export function pageRole(me: Me, pageId: string): Role {
  const page = me.pages.find((p) => p.id === pageId);
  if (!page) notFound();
  return page.role;
}

export function can(role: Role, required: Role): boolean {
  return roleAtLeast(role, required);
}
