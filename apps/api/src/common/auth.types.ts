import { type Role } from '@status-page/shared';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  isBreakGlass: boolean;
}

/**
 * Etapa do segundo fator na sessão:
 * - `ok`: liberada (sem MFA ou com MFA já confirmado);
 * - `pending`: senha conferida, falta confirmar o segundo fator;
 * - `enroll`: a política exige MFA e o usuário ainda não cadastrou nenhum fator.
 */
export type MfaStage = 'ok' | 'pending' | 'enroll';

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  mfa: MfaStage;
  /** Papel do usuário em cada página (pageId → papel). */
  pageRoles: Map<string, Role>;
  /** Requisição autenticada por token de API (age em nome de quem o criou). */
  apiToken?: { id: string; name: string; prefix: string };
}

/** Papel efetivo na página: o Dono tem acesso total a todas. */
export function effectiveRole(auth: AuthContext, pageId: string): Role | undefined {
  if (auth.user.isOwner) return 'owner';
  return auth.pageRoles.get(pageId);
}
