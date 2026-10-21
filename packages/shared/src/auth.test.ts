import { describe, expect, it } from 'vitest';
import { ldapMappingCreateSchema, mfaRequiredFor } from './auth.js';
import { loginSchema } from './schemas.js';

describe('mfaRequiredFor', () => {
  const viewer = { isOwner: false, roles: ['viewer' as const] };
  const owner = { isOwner: true, roles: [] };

  it('respeita os três modos da política', () => {
    expect(mfaRequiredFor({ mode: 'off', roles: [] }, owner)).toBe(false);
    expect(mfaRequiredFor({ mode: 'all', roles: [] }, viewer)).toBe(true);
    const roles = { mode: 'roles' as const, roles: ['owner' as const, 'admin' as const] };
    expect(mfaRequiredFor(roles, owner)).toBe(true);
    expect(mfaRequiredFor(roles, viewer)).toBe(false);
    expect(mfaRequiredFor(roles, { isOwner: false, roles: ['viewer', 'admin'] })).toBe(true);
  });
});

describe('schemas de autenticação', () => {
  it('login aceita o campo antigo `email`', () => {
    expect(loginSchema.parse({ email: 'a@b.com', password: 'x' })).toEqual({
      login: 'a@b.com',
      password: 'x',
    });
  });

  it('mapeamento sem página só para Dono', () => {
    expect(ldapMappingCreateSchema.safeParse({ groupDn: 'cn=x', role: 'owner' }).success).toBe(
      true,
    );
    expect(ldapMappingCreateSchema.safeParse({ groupDn: 'cn=x', role: 'admin' }).success).toBe(
      false,
    );
  });
});
