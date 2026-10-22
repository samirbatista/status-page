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
import {
  MFA_STAGE_KEY,
  OWNER_KEY,
  PAGE_ROLE_KEY,
  PUBLIC_KEY,
  SESSION_ONLY_KEY,
} from '../common/decorators.js';
import { type RequestWithAuth } from '../common/request-meta.js';
import { ApiTokensService } from '../api-tokens/api-tokens.service.js';
import { type AuthContext } from '../common/auth.types.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

/**
 * Guard global: toda rota exige sessão válida, exceto as marcadas com `@Public()`.
 * Também aplica `@RequireOwner()` e `@RequirePageRole()`. Uma sessão com o
 * segundo fator pendente só alcança as rotas marcadas com `@AllowMfaStage()`;
 * nas rotas públicas ela conta como visitante anônimo.
 *
 * Sem cookie, `Authorization: Bearer sp_...` autentica por token de API, que só
 * alcança rotas públicas e rotas de página (`@RequirePageRole`) não marcadas
 * com `@SessionOnly()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly apiTokens: ApiTokensService,
  ) {}

  private bearer(req: RequestWithAuth): string | null {
    const header = req.get('authorization');
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    return match ? match[1]! : null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<RequestWithAuth>();

    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const bearer = token ? null : this.bearer(req);
    let auth: AuthContext | null = null;
    if (token) auth = await this.sessions.resolve(token);
    else if (bearer) {
      auth = await this.apiTokens.resolve(bearer, req.ip ?? null);
      if (!auth) throw new UnauthorizedException({ message: 'invalid_api_token' });
    }

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

    const required = this.reflector.getAllAndOverride<Role>(PAGE_ROLE_KEY, targets);
    if (
      auth.apiToken &&
      (!required || this.reflector.getAllAndOverride<boolean>(SESSION_ONLY_KEY, targets))
    ) {
      throw new ForbiddenException({ message: 'api_token_not_allowed' });
    }

    if (this.reflector.getAllAndOverride<boolean>(OWNER_KEY, targets) && !auth.user.isOwner) {
      throw new ForbiddenException({ message: 'forbidden' });
    }

    if (required) {
      const pageId = req.params.pageId;
      const role = typeof pageId === 'string' ? effectiveRole(auth, pageId) : undefined;
      if (!role || !roleAtLeast(role, required))
        throw new ForbiddenException({ message: 'forbidden' });
    }
    return true;
  }
}
