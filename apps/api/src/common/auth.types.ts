import { type Role } from '@status-page/shared';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  /** Papel do usuário em cada página (pageId → papel). */
  pageRoles: Map<string, Role>;
}

/** Papel efetivo na página: o Dono tem acesso total a todas. */
export function effectiveRole(auth: AuthContext, pageId: string): Role | undefined {
  if (auth.user.isOwner) return 'owner';
  return auth.pageRoles.get(pageId);
}
