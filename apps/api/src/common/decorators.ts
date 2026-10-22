import { SetMetadata } from '@nestjs/common';
import { ApiExcludeController, ApiExcludeEndpoint } from '@nestjs/swagger';
import { type Role } from '@status-page/shared';

export const PUBLIC_KEY = 'auth:public';
export const PAGE_ROLE_KEY = 'auth:pageRole';
export const OWNER_KEY = 'auth:owner';

/** Rota acessível sem sessão. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Exige o papel mínimo na página do parâmetro `:pageId`. */
export const RequirePageRole = (role: Exclude<Role, 'owner'>) => SetMetadata(PAGE_ROLE_KEY, role);

/** Exige que o usuário seja Dono da instalação. */
/**
 * Marca a rota (ou o controller) e a tira da documentação OpenAPI, que só
 * descreve o que um token de API alcança.
 */
function markAndHide(key: string) {
  return (target: object, property?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor && property !== undefined) {
      SetMetadata(key, true)(target, property, descriptor);
      ApiExcludeEndpoint()(target, property, descriptor);
    } else {
      SetMetadata(key, true)(target as never);
      ApiExcludeController()(target as never);
    }
  };
}

export const RequireOwner = () => markAndHide(OWNER_KEY);

export const MFA_STAGE_KEY = 'auth:mfaStage';

/**
 * Rota acessível também com o segundo fator pendente (`pending`) ou com o
 * cadastro de MFA obrigatório ainda por fazer (`enroll`).
 */
export const AllowMfaStage = (...stages: ('pending' | 'enroll')[]) =>
  SetMetadata(MFA_STAGE_KEY, stages);

export const SESSION_ONLY_KEY = 'auth:sessionOnly';

/** Rota que exige sessão do painel: tokens de API não a alcançam. */
export const SessionOnly = () => markAndHide(SESSION_ONLY_KEY);
