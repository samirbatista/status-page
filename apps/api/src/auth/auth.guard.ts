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
import { OWNER_KEY, PAGE_ROLE_KEY, PUBLIC_KEY } from '../common/decorators.js';
import { type RequestWithAuth } from '../common/request-meta.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

/**
 * Guard global: toda rota exige sessão válida, exceto as marcadas com `@Public()`.
 * Também aplica `@RequireOwner()` e `@RequirePageRole()`.
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
    if (token) req.auth = (await this.sessions.resolve(token)) ?? undefined;

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException({ message: 'unauthenticated' });

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
