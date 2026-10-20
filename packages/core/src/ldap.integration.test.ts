import { describe, expect, it } from 'vitest';
import { LDAP_DEFAULTS } from '@status-page/shared';
import { type LdapConfig, LdapDirectory, LdapUnavailableError } from './ldap.js';

/**
 * Testes contra servidores reais. Rodam quando as variáveis apontam para eles
 * (veja docker/ldap-test/README.md); sem elas, são pulados.
 *   TEST_OPENLDAP=localhost:1389   (osixia/openldap com openldap.ldif)
 *   TEST_SAMBA_AD=localhost:2636   (Samba AD com samba-seed.sh, LDAPS)
 */
const openldap = process.env.TEST_OPENLDAP;
const samba = process.env.TEST_SAMBA_AD;

function hostPort(value: string): { host: string; port: number } {
  const [host, port] = value.split(':');
  return { host: host!, port: Number(port) };
}

describe.skipIf(!openldap)('OpenLDAP real', () => {
  const base = (): LdapConfig => ({
    ...LDAP_DEFAULTS.openldap,
    ...hostPort(openldap ?? 'localhost:1389'),
    kind: 'openldap',
    security: 'none',
    verifyCertificate: false,
    caCertificate: null,
    bindDn: 'cn=svc-status,dc=empresa,dc=local',
    bindPassword: 'svc-pass',
    baseDn: 'dc=empresa,dc=local',
    groupBaseDn: 'ou=Grupos,dc=empresa,dc=local',
    timeoutMs: 5000,
  });

  it('testa a conexão e a conta de serviço', async () => {
    await expect(new LdapDirectory(base()).testConnection()).resolves.toHaveProperty('durationMs');
    await expect(
      new LdapDirectory({ ...base(), bindPassword: 'errada' }).testConnection(),
    ).rejects.toMatchObject({ reason: 'service_bind_invalid_credentials' });
    await expect(
      new LdapDirectory({ ...base(), baseDn: 'dc=nao,dc=existe' }).testConnection(),
    ).rejects.toBeInstanceOf(LdapUnavailableError);
  });

  it('autentica por uid ou e-mail e lê os grupos dos três tipos', async () => {
    const dir = new LdapDirectory(base());
    const ana = await dir.authenticate('ana', 'Senha-da-Ana-2026');
    expect(ana.status).toBe('ok');
    if (ana.status !== 'ok') return;
    expect(ana.user).toMatchObject({
      dn: 'uid=ana,ou=Usuarios,dc=empresa,dc=local',
      username: 'ana',
      email: 'ana@empresa.local',
      name: 'Ana Souza',
      groups: ['cn=noc,ou=grupos,dc=empresa,dc=local'],
      disabled: false,
    });
    expect(ana.user.uniqueId).toMatch(/^[0-9a-f-]{36}$/);

    const bruno = await dir.authenticate('bruno@empresa.local', 'Senha-do-Bruno-2026');
    expect(bruno.status === 'ok' && bruno.user.groups).toEqual([
      'cn=plantao,ou=grupos,dc=empresa,dc=local',
      'cn=ti,ou=grupos,dc=empresa,dc=local',
    ]);
  });

  it('senha errada, senha vazia, usuário inexistente e injeção de filtro', async () => {
    const dir = new LdapDirectory(base());
    expect((await dir.authenticate('ana', 'errada')).status).toBe('invalid_credentials');
    expect((await dir.authenticate('ana', '')).status).toBe('invalid_credentials');
    expect((await dir.authenticate('ninguem', 'x')).status).toBe('not_found');
    expect((await dir.authenticate('*', 'Senha-da-Ana-2026')).status).toBe('not_found');
    expect((await dir.authenticate('ana)(uid=*', 'Senha-da-Ana-2026')).status).toBe('not_found');
  });

  it('sem e-mail no diretório, devolve e-mail nulo', async () => {
    const carla = await new LdapDirectory(base()).authenticate('carla', 'Senha-da-Carla-2026');
    expect(carla.status === 'ok' && carla.user.email).toBeNull();
  });

  it('relê o usuário pelo DN na sincronização', async () => {
    const dir = new LdapDirectory(base());
    const ana = await dir.authenticate('ana', 'Senha-da-Ana-2026');
    if (ana.status !== 'ok') throw new Error('login falhou');
    const again = await dir.lookup({
      dn: ana.user.dn,
      username: 'ana',
      uniqueId: ana.user.uniqueId,
    });
    expect(again?.uniqueId).toBe(ana.user.uniqueId);
    const other = await dir.lookup({ dn: ana.user.dn, username: 'ana', uniqueId: 'outro' });
    expect(other).toBeNull();
  });

  it('StartTLS e LDAPS (certificado autoassinado, sem validar)', async () => {
    const starttls = new LdapDirectory({ ...base(), security: 'starttls' });
    expect((await starttls.authenticate('ana', 'Senha-da-Ana-2026')).status).toBe('ok');
    const { host } = hostPort(openldap ?? 'localhost:1389');
    const ldaps = new LdapDirectory({ ...base(), security: 'ldaps', host, port: 1636 });
    expect((await ldaps.authenticate('ana', 'Senha-da-Ana-2026')).status).toBe('ok');
  });

  it('validando o certificado autoassinado, falha com erro de TLS', async () => {
    const strict = new LdapDirectory({ ...base(), security: 'starttls', verifyCertificate: true });
    await expect(strict.testConnection()).rejects.toMatchObject({ reason: 'tls_error' });
  });
});

describe.skipIf(!samba)('Active Directory real (Samba AD)', () => {
  const base = (): LdapConfig => ({
    ...LDAP_DEFAULTS.active_directory,
    ...hostPort(samba ?? 'localhost:2636'),
    kind: 'active_directory',
    security: 'ldaps',
    verifyCertificate: false,
    caCertificate: null,
    bindDn: 'CN=Servico Status,OU=Servico,DC=empresa,DC=local',
    bindPassword: 'Svc-Status-2026!',
    baseDn: 'DC=empresa,DC=local',
    groupBaseDn: null,
    timeoutMs: 10_000,
  });

  it('autentica pelo sAMAccountName e pelo UPN, com grupos aninhados', async () => {
    const dir = new LdapDirectory(base());
    const ana = await dir.authenticate('ana', 'Senha-da-Ana-2026!');
    expect(ana.status).toBe('ok');
    if (ana.status !== 'ok') return;
    expect(ana.user).toMatchObject({
      dn: 'CN=Ana Souza,OU=Usuarios,DC=empresa,DC=local',
      username: 'ana',
      email: 'ana@empresa.local',
      disabled: false,
    });
    // NOC direto e Operacao por aninhamento (LDAP_MATCHING_RULE_IN_CHAIN).
    expect(ana.user.groups).toEqual(
      expect.arrayContaining([
        'cn=noc,ou=grupos,dc=empresa,dc=local',
        'cn=operacao,ou=grupos,dc=empresa,dc=local',
      ]),
    );
    expect(ana.user.uniqueId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const upn = await dir.authenticate('ana@empresa.local', 'Senha-da-Ana-2026!');
    expect(upn.status === 'ok' && upn.user.uniqueId).toBe(ana.user.uniqueId);
  });

  it('sem aninhamento, só os grupos diretos (memberOf)', async () => {
    const dir = new LdapDirectory({ ...base(), nestedGroups: false });
    const ana = await dir.authenticate('ana', 'Senha-da-Ana-2026!');
    expect(ana.status === 'ok' && ana.user.groups).toEqual([
      'cn=noc,ou=grupos,dc=empresa,dc=local',
    ]);
  });

  it('conta desativada no AD é reconhecida como desativada', async () => {
    const dir = new LdapDirectory(base());
    // carla é desativada pelo próprio teste e reativada no fim.
    const { execFileSync } = await import('node:child_process');
    const container = process.env.TEST_SAMBA_CONTAINER ?? 'sp-samba';
    execFileSync('docker', ['exec', container, 'samba-tool', 'user', 'disable', 'carla']);
    try {
      const login = await dir.authenticate('carla', 'Senha-da-Carla-2026!');
      expect(login.status).toBe('disabled');
      const ok = await dir.authenticate('ana', 'Senha-da-Ana-2026!');
      if (ok.status !== 'ok') throw new Error('login falhou');
      const carla = await dir.lookup({
        dn: 'CN=Carla Dias,OU=Usuarios,DC=empresa,DC=local',
        username: 'carla',
        uniqueId: login.status === 'disabled' ? login.user.uniqueId : '',
      });
      expect(carla?.disabled).toBe(true);
    } finally {
      execFileSync('docker', ['exec', container, 'samba-tool', 'user', 'enable', 'carla']);
    }
  });

  it('senha errada não revela se a conta existe', async () => {
    const dir = new LdapDirectory(base());
    expect((await dir.authenticate('ana', 'errada')).status).toBe('invalid_credentials');
    expect((await dir.authenticate('ninguem', 'x')).status).toBe('not_found');
  });
});
