import { SetMetadata } from '@nestjs/common';
import { type Role } from '@status-page/shared';

export const PUBLIC_KEY = 'auth:public';
export const PAGE_ROLE_KEY = 'auth:pageRole';
export const OWNER_KEY = 'auth:owner';

/** Rota acessível sem sessão. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Exige o papel mínimo na página do parâmetro `:pageId`. */
export const RequirePageRole = (role: Exclude<Role, 'owner'>) => SetMetadata(PAGE_ROLE_KEY, role);

/** Exige que o usuário seja Dono da instalação. */
export const RequireOwner = () => SetMetadata(OWNER_KEY, true);

export const MFA_STAGE_KEY = 'auth:mfaStage';

/**
 * Rota acessível também com o segundo fator pendente (`pending`) ou com o
 * cadastro de MFA obrigatório ainda por fazer (`enroll`).
 */
export const AllowMfaStage = (...stages: ('pending' | 'enroll')[]) =>
  SetMetadata(MFA_STAGE_KEY, stages);
