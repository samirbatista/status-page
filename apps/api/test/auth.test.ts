import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  client,
  createHarness,
  createUser,
  loginAs,
  PASSWORD,
  resetState,
  type Harness,
} from './support/harness.js';

describe('autenticação local', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  beforeEach(async () => {
    await resetState(h.prisma, h.redis);
    await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
  });

  afterAll(() => h.close());

  it('login define cookie httpOnly e /me retorna o usuário', async () => {
    const c = client(h.app);
    const res = await c.post('/api/auth/login', { email: 'Dono@Example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/sp_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      email: 'dono@example.com',
      isOwner: true,
      providers: ['local'],
    });
  });

  it('rotas protegidas exigem sessão', async () => {
    expect((await h.anon.get('/api/auth/me')).status).toBe(401);
    expect((await h.anon.get('/api/pages')).status).toBe(401);
  });

  it('mutações sem o cabeçalho anti-CSRF são recusadas', async () => {
    const res = await h.anon.agent
      .post('/api/auth/login')
      .send({ email: 'dono@example.com', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('csrf_header_missing');
  });

  it('senha errada responde 401 genérico e fica na auditoria', async () => {
    const res = await h.anon.post('/api/auth/login', { email: 'dono@example.com', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('invalid_credentials');

    const unknown = await h.anon.post('/api/auth/login', {
      email: 'ninguem@example.com',
      password: 'x',
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe('invalid_credentials');

    const logs = await h.prisma.auditLog.findMany({ where: { action: 'auth.login_failed' } });
    expect(logs).toHaveLength(2);
  });

  it('bloqueia a conta após 5 falhas, mesmo com a senha certa', async () => {
    for (let i = 0; i < 5; i++) {
      await h.anon.post('/api/auth/login', { email: 'dono@example.com', password: 'errada' });
    }
    const res = await h.anon.post('/api/auth/login', {
      email: 'dono@example.com',
      password: PASSWORD,
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('logout encerra a sessão', async () => {
    const c = await loginAs(h, 'dono@example.com');
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('usuário desativado não entra e perde as sessões', async () => {
    const owner = await loginAs(h, 'dono@example.com');
    const user = await createUser(h.prisma, { email: 'ana@example.com' });
    const ana = await loginAs(h, 'ana@example.com');

    expect((await owner.patch(`/api/users/${user.id}`, { disabled: true })).status).toBe(200);
    expect((await ana.get('/api/auth/me')).status).toBe(401);
    const res = await h.anon.post('/api/auth/login', {
      email: 'ana@example.com',
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
  });

  it('troca de senha aplica a política e encerra as outras sessões', async () => {
    const a = await loginAs(h, 'dono@example.com');
    const b = await loginAs(h, 'dono@example.com');

    const weak = await a.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'curta',
    });
    expect(weak.status).toBe(400);
    expect(weak.body).toMatchObject({ message: 'password_policy', problems: ['too_short'] });

    const ok = await a.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'uma-nova-senha-segura-2026',
    });
    expect(ok.status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
  });

  it('não permite remover o último Dono', async () => {
    const owner = await loginAs(h, 'dono@example.com');
    const me = await owner.get('/api/auth/me');
    const res = await owner.patch(`/api/users/${me.body.id}`, { isOwner: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('last_owner');
  });

  it('criação de usuário exige senha dentro da política', async () => {
    const owner = await loginAs(h, 'dono@example.com');
    const weak = await owner.post('/api/users', {
      email: 'bia@example.com',
      name: 'Bia',
      password: 'password1234',
    });
    expect(weak.status).toBe(400);
    const ok = await owner.post('/api/users', {
      email: 'bia@example.com',
      name: 'Bia',
      password: 'girassol-azul-na-janela',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).not.toHaveProperty('passwordHash');
  });
});
