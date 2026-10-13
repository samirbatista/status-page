import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ipInCidrs } from '@status-page/core';
import { type Page } from '@status-page/db';
import { type AuthContext, effectiveRole } from '../common/auth.types.js';

/**
 * Regras de acesso de páginas privadas:
 * - `login`: usuário com qualquer papel na página (ou Dono);
 * - `ip`: requisição vinda de uma das redes liberadas;
 * - `login_or_ip` / `login_and_ip`: combinações das duas.
 *
 * Sem sessão, responde 401 (`login_required`) para o site levar ao login;
 * com sessão mas sem permissão, ou fora das redes liberadas, responde 403.
 */
export function assertCanView(
  page: Pick<Page, 'id' | 'visibility' | 'privateAccess' | 'allowedCidrs'>,
  auth: AuthContext | undefined,
  ip: string | null | undefined,
): void {
  if (page.visibility === 'public') return;

  const hasRole = Boolean(auth && effectiveRole(auth, page.id));
  const ipAllowed = ipInCidrs(ip, page.allowedCidrs);
  const needLogin = () =>
    auth
      ? new ForbiddenException({ message: 'private_page_forbidden' })
      : new UnauthorizedException({ message: 'login_required' });

  switch (page.privateAccess) {
    case 'login':
      if (!hasRole) throw needLogin();
      return;
    case 'ip':
      if (!ipAllowed) throw new ForbiddenException({ message: 'ip_not_allowed' });
      return;
    case 'login_or_ip':
      if (!hasRole && !ipAllowed) throw needLogin();
      return;
    case 'login_and_ip':
      if (!ipAllowed) throw new ForbiddenException({ message: 'ip_not_allowed' });
      if (!hasRole) throw needLogin();
      return;
  }
}

/** Páginas privadas não devem ser guardadas em caches compartilhados. */
export function cacheControlFor(page: Pick<Page, 'visibility'>): string {
  return page.visibility === 'public' ? 'public, max-age=15' : 'private, no-store';
}
