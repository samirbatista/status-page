import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type DirectoryUser,
  type LdapAuthResult,
  LdapUnavailableError,
  totpCode,
  totpStep,
} from '@status-page/core';
import { AuthSettingsService } from '../src/auth/auth-settings.service.js';
import { type Directory, LdapService } from '../src/ldap/ldap.service.js';
import {
  type Client,
  client,
  createHarness,
  createUser,
  loginAs,
  PASSWORD,
  resetState,
  type Harness,
} from './support/harness.js';

/** Diretório falso: usuários em memória, com a opção de "derrubar" o servidor. */
class FakeDirectory implements Directory {
  users = new Map<string, { password: string; user: DirectoryUser }>();
  down = false;

  add(username: string, groups: string[], extra: Partial<DirectoryUser> = {}) {
    this.users.set(username.toLowerCase(), {
      password: 'senha-do-ad-123',
      user: {
        dn: `CN=${username},OU=Usuarios,DC=empresa,DC=local`,
        uniqueId: `guid-${username}`,
        username,
        email: `${username}@empresa.local`,
        name: `Usuário ${username}`,
        groups,
        disabled: false,
        ...extra,
      },
    });
  }

  async testConnection() {
    if (this.down) throw new LdapUnavailableError('connection_refused');
    return { durationMs: 1 };
  }

  async authenticate(username: string, password: string): Promise<LdapAuthResult> {
    if (this.down) throw new LdapUnavailableError('connection_refused');
    const found = this.users.get(username.toLowerCase());
    if (!found) return { status: 'not_found' };
    if (found.user.disabled) return { status: 'disabled', user: found.user };
    if (found.password !== password) return { status: 'invalid_credentials' };
    return { status: 'ok', user: structuredClone(found.user) };
  }

  async lookup(known: { uniqueId: string }) {
    if (this.down) throw new LdapUnavailableError('connection_refused');
    const found = [...this.users.values()].find((u) => u.user.uniqueId === known.uniqueId);
    return found ? structuredClone(found.user) : null;
  }
}

const PROVIDER = {
  name: 'AD da empresa',
  kind: 'active_directory',
  host: 'dc01.empresa.local',
  port: 636,
  security: 'ldaps',
  bindDn: 'CN=svc-status,OU=Servico,DC=empresa,DC=local',
  bindPassword: 'segredo-do-bind',
  baseDn: 'DC=empresa,DC=local',
  userFilter: '(&(objectClass=user)(sAMAccountName={username}))',
  usernameAttribute: 'sAMAccountName',
  emailAttribute: 'mail',
  nameAttribute: 'displayName',
  uniqueIdAttribute: 'objectGUID',
  nestedGroups: true,
};

const NOC = 'CN=NOC,OU=Grupos,DC=empresa,DC=local';
const TI = 'CN=TI,OU=Grupos,DC=empresa,DC=local';

/** Código TOTP atual a partir do segredo devolvido no cadastro. */
function currentCode(secret: string, offsetSteps = 0): string {
  return totpCode(secret, totpStep() + offsetSteps);
}

describe('F3: LDAP, MFA e conta de emergência', () => {
  let h: Harness;
  let fake: FakeDirectory;
  let owner: Client;
  let pageId: string;
  let providerId: string;

  beforeAll(async () => {
    h = await createHarness();
  });

  beforeEach(async () => {
    await resetState(h.prisma, h.redis);
    fake = new FakeDirectory();
    h.app.get(LdapService).directoryFactory = () => fake;
    h.app.get(AuthSettingsService).invalidate();
    await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
    owner = await loginAs(h, 'dono@example.com');
    pageId = (await owner.post('/api/pages', { slug: 'interna', name: 'Interna' })).body.id;
    const created = await owner.post('/api/ldap/providers', PROVIDER);
    expect(created.status).toBe(201);
    providerId = created.body.id;
  });

  afterAll(() => h.close());

  describe('provedores LDAP', () => {
    it('guarda a senha do bind cifrada e nunca a devolve', async () => {
      const row = await h.prisma.ldapProvider.findUniqueOrThrow({ where: { id: providerId } });
      expect(row.bindPasswordEnc).not.toContain('segredo');
      const list = await owner.get('/api/ldap/providers');
      expect(JSON.stringify(list.body)).not.toContain('segredo');
      expect(JSON.stringify(list.body)).not.toContain('bindPassword');
    });

    it('só o Dono configura provedores', async () => {
      await createUser(h.prisma, { email: 'admin@example.com', roles: { [pageId]: 'admin' } });
      const admin = await loginAs(h, 'admin@example.com');
      expect((await admin.get('/api/ldap/providers')).status).toBe(403);
    });

    it('teste de conexão reaproveita a senha salva e informa a falha', async () => {
      const form: Partial<typeof PROVIDER> = { ...PROVIDER };
      delete form.bindPassword;
      const ok = await owner.post('/api/ldap/providers/test-connection', {
        ...form,
        id: providerId,
      });
      expect(ok.body).toMatchObject({ ok: true });
      fake.down = true;
      const down = await owner.post('/api/ldap/providers/test-connection', {
        ...form,
        id: providerId,
      });
      expect(down.body).toEqual({ ok: false, error: 'connection_refused' });
    });

    it('teste de login mostra grupos e papéis sem criar o usuário', async () => {
      await owner.post(`/api/ldap/providers/${providerId}/mappings`, {
        groupDn: NOC,
        pageId,
        role: 'operator',
      });
      fake.add('ana', [NOC.toLowerCase()]);
      const res = await owner.post(`/api/ldap/providers/${providerId}/test-login`, {
        username: 'ana',
        password: 'senha-do-ad-123',
      });
      expect(res.body.status).toBe('ok');
      expect(res.body.roles.pages).toEqual([{ pageId, pageName: 'Interna', role: 'operator' }]);
      expect(await h.prisma.user.count({ where: { email: 'ana@empresa.local' } })).toBe(0);
    });

    it('mapeamento global só aceita o papel de Dono', async () => {
      const bad = await owner.post(`/api/ldap/providers/${providerId}/mappings`, {
        groupDn: TI,
        role: 'admin',
      });
      expect(bad.status).toBe(400);
      const good = await owner.post(`/api/ldap/providers/${providerId}/mappings`, {
        groupDn: TI,
        role: 'owner',
      });
      expect(good.status).toBe(201);
      expect(good.body.groupDn).toBe('cn=ti,ou=grupos,dc=empresa,dc=local');
    });
  });

  describe('login pelo diretório', () => {
    beforeEach(async () => {
      await owner.post(`/api/ldap/providers/${providerId}/mappings`, {
        groupDn: NOC,
        pageId,
        role: 'operator',
      });
      await owner.post(`/api/ldap/providers/${providerId}/mappings`, {
        groupDn: TI,
        pageId,
        role: 'admin',
      });
    });

    it('cria o usuário no primeiro login com o papel do grupo', async () => {
      fake.add('ana', [NOC.toLowerCase()]);
      const ana = client(h.app);
      const res = await ana.post('/api/auth/login', { login: 'ana', password: 'senha-do-ad-123' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, mfa: null });

      const me = await ana.get('/api/auth/me');
      expect(me.body).toMatchObject({
        email: 'ana@empresa.local',
        name: 'Usuário ana',
        providers: ['ldap'],
        pages: [{ id: pageId, role: 'operator' }],
      });
      const audit = await h.prisma.auditLog.findMany({ where: { action: 'ldap.user_create' } });
      expect(audit).toHaveLength(1);
    });

    it('a cada login sincroniza grupos: mudar de grupo muda o papel', async () => {
      fake.add('ana', [NOC.toLowerCase()]);
      await loginAs(h, 'ana', 'senha-do-ad-123');
      fake.users.get('ana')!.user.groups = [TI.toLowerCase()];
      const again = await loginAs(h, 'ana', 'senha-do-ad-123');
      expect((await again.get('/api/auth/me')).body.pages).toEqual([
        expect.objectContaining({ id: pageId, role: 'admin' }),
      ]);
      fake.users.get('ana')!.user.groups = [];
      const third = await loginAs(h, 'ana', 'senha-do-ad-123');
      expect((await third.get('/api/auth/me')).body.pages).toEqual([]);
    });

    it('papel manual prevalece sobre o mapeado (configuração padrão)', async () => {
      fake.add('ana', [NOC.toLowerCase()]);
      const ana = await loginAs(h, 'ana', 'senha-do-ad-123');
      const anaId = (await ana.get('/api/auth/me')).body.id;
      await owner.put(`/api/pages/${pageId}/team/${anaId}`, { role: 'viewer' });
      await loginAs(h, 'ana', 'senha-do-ad-123');
      const role = await h.prisma.userPageRole.findFirstOrThrow({ where: { userId: anaId } });
      expect(role).toMatchObject({ role: 'viewer', manual: true });
    });

    it('senha errada e usuário inexistente respondem igual', async () => {
      fake.add('ana', []);
      const wrong = await h.anon.post('/api/auth/login', { login: 'ana', password: 'errada' });
      const missing = await h.anon.post('/api/auth/login', { login: 'bob', password: 'x' });
      expect(wrong.status).toBe(401);
      expect(missing.status).toBe(401);
      expect(wrong.body.message).toBe(missing.body.message);
    });

    it('conta desativada no diretório perde o acesso na sincronização', async () => {
      fake.add('ana', [NOC.toLowerCase()]);
      const ana = await loginAs(h, 'ana', 'senha-do-ad-123');
      expect((await ana.get('/api/auth/me')).status).toBe(200);

      fake.users.get('ana')!.user.disabled = true;
      const sync = await owner.post(`/api/ldap/providers/${providerId}/sync`);
      expect(sync.body).toMatchObject({ checked: 1, disabled: 1, error: null });

      expect((await ana.get('/api/auth/me')).status).toBe(401);
      const relogin = await h.anon.post('/api/auth/login', {
        login: 'ana',
        password: 'senha-do-ad-123',
      });
      expect(relogin.status).toBe(401);
      const anaUser = await h.prisma.user.findUniqueOrThrow({
        where: { email: 'ana@empresa.local' },
        include: { pageRoles: true },
      });
      expect(anaUser.pageRoles).toHaveLength(0);
    });

    it('conta removida do diretório também perde o acesso', async () => {
      fake.add('ana', []);
      const ana = await loginAs(h, 'ana', 'senha-do-ad-123');
      fake.users.delete('ana');
      await owner.post(`/api/ldap/providers/${providerId}/sync`);
      expect((await ana.get('/api/auth/me')).status).toBe(401);
    });

    it('com o diretório fora do ar, a sincronização não desativa ninguém', async () => {
      fake.add('ana', []);
      const ana = await loginAs(h, 'ana', 'senha-do-ad-123');
      fake.down = true;
      const sync = await owner.post(`/api/ldap/providers/${providerId}/sync`);
      expect(sync.body).toMatchObject({ disabled: 0, error: 'connection_refused' });
      expect((await ana.get('/api/auth/me')).status).toBe(200);
    });

    it('diretório fora do ar: login LDAP avisa e a conta local continua entrando', async () => {
      fake.add('ana', []);
      fake.down = true;
      const res = await h.anon.post('/api/auth/login', {
        login: 'ana',
        password: 'senha-do-ad-123',
      });
      expect(res.status).toBe(503);
      expect(res.body.message).toBe('directory_unavailable');
      await loginAs(h, 'dono@example.com');
    });

    it('não toma conta local com o mesmo e-mail, a menos que o provedor permita', async () => {
      await createUser(h.prisma, { email: 'ana@empresa.local' });
      fake.add('ana', []);
      const res = await h.anon.post('/api/auth/login', {
        login: 'ana',
        password: 'senha-do-ad-123',
      });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('ldap_email_conflict');

      await owner.patch(`/api/ldap/providers/${providerId}`, {
        ...PROVIDER,
        bindPassword: '',
        linkByEmail: true,
      });
      const linked = await loginAs(h, 'ana', 'senha-do-ad-123');
      expect((await linked.get('/api/auth/me')).body.providers.sort()).toEqual(['ldap', 'local']);
    });

    it('grupo mapeado para Dono concede e retira o papel global', async () => {
      await owner.post(`/api/ldap/providers/${providerId}/mappings`, {
        groupDn: 'CN=Diretoria,DC=empresa,DC=local',
        role: 'owner',
      });
      fake.add('ana', ['cn=diretoria,dc=empresa,dc=local']);
      const ana = await loginAs(h, 'ana', 'senha-do-ad-123');
      expect((await ana.get('/api/auth/me')).body.isOwner).toBe(true);
      fake.users.get('ana')!.user.groups = [];
      const again = await loginAs(h, 'ana', 'senha-do-ad-123');
      expect((await again.get('/api/auth/me')).body.isOwner).toBe(false);
    });
  });

  describe('conta de emergência e login local restrito', () => {
    it('restringir exige uma conta de emergência', async () => {
      const res = await owner.put('/api/auth/settings', {
        mfa: { mode: 'off', roles: [] },
        localLogin: 'break_glass_only',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('break_glass_required');
    });

    it('com a restrição, só a conta de emergência entra com senha local', async () => {
      const dono = await h.prisma.user.findUniqueOrThrow({ where: { email: 'dono@example.com' } });
      expect((await owner.patch(`/api/users/${dono.id}`, { breakGlass: true })).status).toBe(200);
      await createUser(h.prisma, { email: 'local@example.com', roles: { [pageId]: 'viewer' } });
      const set = await owner.put('/api/auth/settings', {
        mfa: { mode: 'off', roles: [] },
        localLogin: 'break_glass_only',
      });
      expect(set.status).toBe(200);

      const blocked = await h.anon.post('/api/auth/login', {
        login: 'local@example.com',
        password: PASSWORD,
      });
      expect(blocked.status).toBe(401);
      await loginAs(h, 'dono@example.com');
      const logs = await h.prisma.auditLog.findMany({
        where: { action: 'auth.break_glass_login' },
      });
      expect(logs.length).toBeGreaterThan(0);

      // A última conta de emergência não pode deixar de ser enquanto houver a restrição.
      const res = await owner.patch(`/api/users/${dono.id}`, { breakGlass: false });
      expect(res.body.message).toBe('last_break_glass');
    });
  });

  describe('MFA com TOTP e códigos de recuperação', () => {
    async function enableTotp(c: Client) {
      const setup = await c.post('/api/auth/mfa/totp/setup');
      expect(setup.status).toBe(200);
      expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\//);
      expect(setup.body.qrSvg).toContain('<svg');
      const confirm = await c.post('/api/auth/mfa/totp/confirm', {
        code: currentCode(setup.body.secret),
      });
      expect(confirm.status).toBe(200);
      expect(confirm.body.recoveryCodes).toHaveLength(10);
      return { secret: setup.body.secret as string, codes: confirm.body.recoveryCodes as string[] };
    }

    it('login pede o segundo fator e bloqueia o resto até confirmar', async () => {
      const { secret } = await enableTotp(owner);
      const row = await h.prisma.totpSecret.findFirstOrThrow();
      expect(row.secretEnc).not.toContain(secret);

      const c = client(h.app);
      const login = await c.post('/api/auth/login', {
        login: 'dono@example.com',
        password: PASSWORD,
      });
      expect(login.body).toEqual({ ok: true, mfa: 'pending' });
      const firstCookie = String(login.headers['set-cookie']);

      const blocked = await c.get('/api/pages');
      expect(blocked.status).toBe(401);
      expect(blocked.body.message).toBe('mfa_required');
      const me = await c.get('/api/auth/me');
      expect(me.body).toMatchObject({ mfa: 'pending', mfaMethods: ['totp'], pages: [] });

      expect(
        (await c.post('/api/auth/mfa/verify', { method: 'totp', code: '000000' })).status,
      ).toBe(401);
      const ok = await c.post('/api/auth/mfa/verify', {
        method: 'totp',
        code: currentCode(secret, 1),
      });
      expect(ok.status).toBe(200);
      // O token muda ao confirmar o MFA (sem fixação de sessão).
      expect(String(ok.headers['set-cookie'])).not.toBe(firstCookie);
      expect((await c.get('/api/pages')).status).toBe(200);
    });

    it('o mesmo código TOTP não serve duas vezes', async () => {
      const { secret } = await enableTotp(owner);
      const code = currentCode(secret, 1);
      const a = client(h.app);
      await a.post('/api/auth/login', { login: 'dono@example.com', password: PASSWORD });
      expect((await a.post('/api/auth/mfa/verify', { method: 'totp', code })).status).toBe(200);
      const b = client(h.app);
      await b.post('/api/auth/login', { login: 'dono@example.com', password: PASSWORD });
      expect((await b.post('/api/auth/mfa/verify', { method: 'totp', code })).status).toBe(401);
    });

    it('código de recuperação funciona uma única vez', async () => {
      const { codes } = await enableTotp(owner);
      const stored = await h.prisma.recoveryCode.findMany();
      expect(stored.every((r) => !codes.includes(r.codeHash))).toBe(true);

      const a = client(h.app);
      await a.post('/api/auth/login', { login: 'dono@example.com', password: PASSWORD });
      const used = await a.post('/api/auth/mfa/verify', {
        method: 'recovery',
        code: codes[0]!.toLowerCase().replace('-', ' '),
      });
      expect(used.status).toBe(200);
      const b = client(h.app);
      await b.post('/api/auth/login', { login: 'dono@example.com', password: PASSWORD });
      expect(
        (await b.post('/api/auth/mfa/verify', { method: 'recovery', code: codes[0] })).status,
      ).toBe(401);
    });

    it('erros seguidos bloqueiam a verificação', async () => {
      await enableTotp(owner);
      const c = client(h.app);
      await c.post('/api/auth/login', { login: 'dono@example.com', password: PASSWORD });
      for (let i = 0; i < 5; i++) {
        await c.post('/api/auth/mfa/verify', { method: 'totp', code: '000000' });
      }
      const res = await c.post('/api/auth/mfa/verify', { method: 'totp', code: '000000' });
      expect(res.status).toBe(429);
    });

    it('MFA vale também para o login LDAP', async () => {
      fake.add('ana', []);
      const ana = await loginAs(h, 'ana', 'senha-do-ad-123');
      await enableTotp(ana);
      const again = client(h.app);
      const res = await again.post('/api/auth/login', {
        login: 'ana',
        password: 'senha-do-ad-123',
      });
      expect(res.body.mfa).toBe('pending');
    });

    it('o Dono redefine o MFA de um usuário, com auditoria', async () => {
      await createUser(h.prisma, { email: 'op@example.com', roles: { [pageId]: 'operator' } });
      const op = await loginAs(h, 'op@example.com');
      await enableTotp(op);
      const opId = (await op.get('/api/auth/me')).body.id;

      const res = await owner.post(`/api/users/${opId}/mfa/reset`);
      expect(res.status).toBe(204);
      expect(await h.prisma.totpSecret.count({ where: { userId: opId } })).toBe(0);
      expect((await op.get('/api/auth/me')).status).toBe(401);
      expect(await h.prisma.auditLog.count({ where: { action: 'user.mfa_reset' } })).toBe(1);
    });

    it('o Admin só redefine o MFA de quem é da equipe dele', async () => {
      await createUser(h.prisma, { email: 'admin@example.com', roles: { [pageId]: 'admin' } });
      await createUser(h.prisma, { email: 'op@example.com', roles: { [pageId]: 'operator' } });
      const other = await createUser(h.prisma, { email: 'fora@example.com' });
      const admin = await loginAs(h, 'admin@example.com');
      const op = await h.prisma.user.findUniqueOrThrow({ where: { email: 'op@example.com' } });
      const dono = await h.prisma.user.findUniqueOrThrow({ where: { email: 'dono@example.com' } });
      expect((await admin.post(`/api/users/${op.id}/mfa/reset`)).status).toBe(204);
      expect((await admin.post(`/api/users/${other.id}/mfa/reset`)).status).toBe(403);
      expect((await admin.post(`/api/users/${dono.id}/mfa/reset`)).status).toBe(403);
    });
  });

  describe('política de MFA', () => {
    it('modo "todos": sem fator cadastrado, só dá para cadastrar', async () => {
      await createUser(h.prisma, { email: 'op@example.com', roles: { [pageId]: 'operator' } });
      await owner.put('/api/auth/settings', { mfa: { mode: 'all', roles: [] }, localLogin: 'all' });

      const op = client(h.app);
      const login = await op.post('/api/auth/login', {
        login: 'op@example.com',
        password: PASSWORD,
      });
      expect(login.body.mfa).toBe('enroll');
      const blocked = await op.get(`/api/pages/${pageId}/incidents`);
      expect(blocked.status).toBe(401);
      expect(blocked.body.message).toBe('mfa_enrollment_required');

      const setup = await op.post('/api/auth/mfa/totp/setup');
      await op.post('/api/auth/mfa/totp/confirm', { code: currentCode(setup.body.secret) });
      expect((await op.get(`/api/pages/${pageId}/incidents`)).status).toBe(200);

      // O último fator não pode ser removido enquanto a política exigir MFA.
      const remove = await op.delete('/api/auth/mfa/totp');
      expect(remove.status).toBe(400);
      expect(remove.body.message).toBe('mfa_required_by_policy');
    });

    it('modo "por papel" exige só de quem tem o papel', async () => {
      await createUser(h.prisma, { email: 'leitor@example.com', roles: { [pageId]: 'viewer' } });
      await createUser(h.prisma, { email: 'admin@example.com', roles: { [pageId]: 'admin' } });
      await owner.put('/api/auth/settings', {
        mfa: { mode: 'roles', roles: ['admin', 'owner'] },
        localLogin: 'all',
      });
      const viewer = await h.anon.post('/api/auth/login', {
        login: 'leitor@example.com',
        password: PASSWORD,
      });
      expect(viewer.body.mfa).toBeNull();
      const admin = await client(h.app).post('/api/auth/login', {
        login: 'admin@example.com',
        password: PASSWORD,
      });
      expect(admin.body.mfa).toBe('enroll');
    });

    it('sessão pendente conta como anônima nas rotas públicas', async () => {
      await owner.patch(`/api/pages/${pageId}`, { visibility: 'private', privateAccess: 'login' });
      await owner
        .post('/api/auth/mfa/totp/setup')
        .then((s) =>
          owner.post('/api/auth/mfa/totp/confirm', { code: currentCode(s.body.secret) }),
        );
      const c = client(h.app);
      await c.post('/api/auth/login', { login: 'dono@example.com', password: PASSWORD });
      expect((await c.get('/api/public/pages/interna')).status).toBe(401);
    });
  });
});
