import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { SESSION_COOKIE } from '../auth/session.service.js';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'status-page';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção contra CSRF: requisições que alteram estado precisam de um cabeçalho
 * customizado. Navegadores não enviam cabeçalhos customizados entre origens sem
 * preflight CORS, e a API não libera CORS.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    // Webhooks de entrada (F5) são autenticados por token e ficam fora desta regra.
    if (req.path.startsWith('/api/hooks/')) return true;
    // Token de API sem cookie: o navegador não anexa esse cabeçalho sozinho, então
    // não há CSRF possível. Com cookie de sessão junto, a regra normal vale.
    if (/^Bearer\s/i.test(req.get('authorization') ?? '') && !req.cookies?.[SESSION_COOKIE]) {
      return true;
    }
    if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      throw new ForbiddenException({ message: 'csrf_header_missing' });
    }
    return true;
  }
}
