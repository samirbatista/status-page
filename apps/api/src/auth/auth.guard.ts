import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Role, roleAtLeast } from '@status-page/shared';
import { effectiveRole } from '../common/auth.types.js';
import { MFA_STAGE_KEY, OWNER_KEY, PAGE_ROLE_KEY, PUBLIC_KEY } from '../common/decorators.js';
import { type RequestWithAuth } from '../common/request-meta.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

/**
 * Guard global: toda rota exige sessão válida, exceto as marcadas com `@Public()`.
 * Também aplica `@RequireOwner()` e `@RequirePageRole()`. Uma sessão com o
 * segundo fator pendente só alcança as rotas marcadas com `@AllowMfaStage()`;
 * nas rotas públicas ela conta como visitante anônimo.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<RequestWithAuth>();

    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const auth = token ? await this.sessions.resolve(token) : null;

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) {
      req.auth = auth?.mfa === 'ok' ? auth : undefined;
      return true;
    }
    if (!auth) throw new UnauthorizedException({ message: 'unauthenticated' });
    if (auth.mfa !== 'ok') {
      const allowed = this.reflector.getAllAndOverride<string[]>(MFA_STAGE_KEY, targets) ?? [];
      if (!allowed.includes(auth.mfa)) {
        throw new UnauthorizedException({
          message: auth.mfa === 'pending' ? 'mfa_required' : 'mfa_enrollment_required',
        });
      }
    }
    req.auth = auth;

    if (this.reflector.getAllAndOverride<boolean>(OWNER_KEY, targets) && !auth.user.isOwner) {
      throw new ForbiddenException({ message: 'forbidden' });
    }

    const required = this.reflector.getAllAndOverride<Role>(PAGE_ROLE_KEY, targets);
    if (required) {
      const pageId = req.params.pageId;
      const role = typeof pageId === 'string' ? effectiveRole(auth, pageId) : undefined;
      if (!role || !roleAtLeast(role, required))
        throw new ForbiddenException({ message: 'forbidden' });
    }
    return true;
  }
}
