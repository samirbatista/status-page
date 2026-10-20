import { describe, expect, it } from 'vitest';
import { escapeFilterValue, formatObjectGuid, normalizeDn, renderFilter } from './ldap.js';
import { mappedRoles } from './ldap-sync.js';

describe('helpers LDAP', () => {
  it('escapa valores de filtro (RFC 4515)', () => {
    expect(escapeFilterValue('a*b(c)d\\e\0')).toBe('a\\2ab\\28c\\29d\\5ce\\00');
    expect(
      renderFilter('(&(uid={username})(member={dn}))', { username: '*)(uid=*', dn: 'cn=x' }),
    ).toBe('(&(uid=\\2a\\29\\28uid=\\2a)(member=cn=x))');
  });

  it('normaliza DNs para comparação', () => {
    expect(normalizeDn(' CN=NOC, OU=Grupos ,DC=Empresa,DC=local ')).toBe(
      'cn=noc,ou=grupos,dc=empresa,dc=local',
    );
  });

  it('formata o objectGUID do AD', () => {
    const buf = Buffer.from('0b1d2e3f4a5b6c7d8e9fa0b1c2d3e4f5', 'hex');
    expect(formatObjectGuid(buf)).toBe('3f2e1d0b-5b4a-7d6c-8e9f-a0b1c2d3e4f5');
  });
});

describe('mappedRoles', () => {
  const mappings = [
    { groupDn: 'CN=NOC,OU=Grupos,DC=empresa,DC=local', pageId: 'p1', role: 'operator' as const },
    { groupDn: 'cn=ti,ou=grupos,dc=empresa,dc=local', pageId: 'p1', role: 'admin' as const },
    { groupDn: 'cn=ti,ou=grupos,dc=empresa,dc=local', pageId: 'p2', role: 'viewer' as const },
    { groupDn: 'cn=diretoria,dc=empresa,dc=local', pageId: null, role: 'owner' as const },
  ];

  it('o maior papel vence em cada página e o DN é comparado sem caixa', () => {
    const result = mappedRoles(mappings, [
      'cn=noc,ou=grupos,dc=empresa,dc=local',
      'CN=TI, OU=Grupos, DC=empresa, DC=local',
    ]);
    expect(Object.fromEntries(result.pages)).toEqual({ p1: 'admin', p2: 'viewer' });
    expect(result.owner).toBe(false);
  });

  it('mapeamento global concede o papel de Dono', () => {
    const result = mappedRoles(mappings, ['cn=diretoria,dc=empresa,dc=local']);
    expect(result.owner).toBe(true);
    expect(result.pages.size).toBe(0);
  });
});
