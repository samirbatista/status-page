import request from 'supertest';
import { DEFAULT_THEME } from '@status-page/shared';
import { fanOutEvent } from '@status-page/notifiers';
import { SecretsService } from '../src/infra/secrets.service.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Client,
  createHarness,
  createUser,
  loginAs,
  resetState,
  type Harness,
} from './support/harness.js';

describe('F6: API, feeds e distribuição', () => {
  let h: Harness;
  let owner: Client;
  let pageId: string;
  let apiId: string;

  /** Requisição sem cookie, com o token no cabeçalho Authorization. */
  const bearer = (token: string) => {
    const agent = request(h.app.getHttpServer());
    return {
      get: (url: string) => agent.get(url).set('Authorization', `Bearer ${token}`),
      post: (url: string, body?: object) =>
        agent.post(url).set('Authorization', `Bearer ${token}`).send(body),
      put: (url: string, body?: object) =>
        agent.put(url).set('Authorization', `Bearer ${token}`).send(body),
    };
  };

  async function createToken(by: Client, body: object) {
    const res = await by.post(`/api/pages/${pageId}/api-tokens`, body);
    expect(res.status).toBe(201);
    return res.body as { id: string; token: string; prefix: string };
  }

  beforeAll(async () => {
    h = await createHarness({
      PUBLIC_URL: 'https://status.acme.test',
      WEBHOOK_EXTRA_HOSTS: 'hooks.interno.test',
    });
  });

  beforeEach(async () => {
    await resetState(h.prisma, h.redis);
    await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
    owner = await loginAs(h, 'dono@example.com');
    pageId = (await owner.post('/api/pages', { slug: 'acme', name: 'Acme' })).body.id;
    apiId = (await owner.post(`/api/pages/${pageId}/components`, { name: 'API' })).body.id;
  });

  afterAll(async () => {
    await h.close();
  });

  describe('tokens de API', () => {
    it('token Operador abre incidente sem cookie nem cabeçalho CSRF; só o hash é guardado', async () => {
      const created = await createToken(owner, { name: 'CI/CD', role: 'operator' });
      expect(created.token).toMatch(/^sp_[\w-]{40,}$/);
      expect(created.prefix).toBe(created.token.slice(0, 9));
      const stored = await h.prisma.apiToken.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.tokenHash).not.toContain(created.token);
      const list = await owner.get(`/api/pages/${pageId}/api-tokens`);
      expect(JSON.stringify(list.body)).not.toContain(created.token);

      const api = bearer(created.token);
      const res = await api.post(`/api/pages/${pageId}/incidents`, {
        title: 'Deploy com falha',
        impact: 'minor',
        status: 'investigating',
        body: 'Revertendo.',
        notify: false,
        components: [{ componentId: apiId, status: 'degraded_performance' }],
      });
      expect(res.status).toBe(201);

      // Auditoria: autor é quem criou o token, identificado no user-agent.
      const audit = await h.prisma.auditLog.findFirstOrThrow({
        where: { action: 'incident.create' },
      });
      expect(audit.userAgent).toContain(`api-token:${created.prefix}`);
      const usage = await h.prisma.apiToken.findUniqueOrThrow({ where: { id: created.id } });
      expect(usage.lastUsedAt).not.toBeNull();
    });

    it('token Leitor só lê; outra página, rotas de sessão e de Dono são negadas', async () => {
      const { token } = await createToken(owner, { name: 'Leitura', role: 'viewer' });
      const api = bearer(token);
      expect((await api.get(`/api/pages/${pageId}/incidents`)).status).toBe(200);
      expect((await api.post(`/api/pages/${pageId}/components`, { name: 'X' })).status).toBe(403);

      const other = (await owner.post('/api/pages', { slug: 'outra', name: 'Outra' })).body.id;
      expect((await api.get(`/api/pages/${other}/incidents`)).status).toBe(403);
      expect((await api.get('/api/auth/me')).body.message).toBe('api_token_not_allowed');
      expect((await api.get('/api/users')).status).toBe(403);
      // Um token não cria outro token.
      expect(
        (await api.post(`/api/pages/${pageId}/api-tokens`, { name: 'x', role: 'viewer' })).status,
      ).toBe(403);
    });

    it('token criado pelo Dono nunca tem poderes de Dono', async () => {
      const { token } = await createToken(owner, { name: 'Admin', role: 'admin' });
      const api = bearer(token);
      expect((await api.get(`/api/pages/${pageId}/monitors`)).status).toBe(200);
      expect((await api.get('/api/notifications/settings')).status).toBe(403);
      // Não mexe na equipe (se promover sobreviveria à revogação) nem exporta assinantes.
      const me = await h.prisma.user.findFirstOrThrow({ where: { email: 'dono@example.com' } });
      expect((await api.get(`/api/pages/${pageId}/team`)).status).toBe(403);
      expect((await api.put(`/api/pages/${pageId}/team/${me.id}`, { role: 'admin' })).status).toBe(
        403,
      );
      expect((await api.get(`/api/pages/${pageId}/subscribers/export.csv`)).status).toBe(403);
    });

    it('revogado, expirado, inválido ou de quem perdeu o acesso deixa de valer', async () => {
      await createUser(h.prisma, { email: 'admin@example.com', roles: { [pageId]: 'admin' } });
      const admin = await loginAs(h, 'admin@example.com');
      // Admin não cria token acima do próprio papel... e o de Admin funciona.
      const a = await createToken(admin, { name: 'Admin', role: 'admin' });
      expect((await bearer(a.token).get(`/api/pages/${pageId}/incidents`)).status).toBe(200);

      // Quem criou perdeu o papel na página: o token cai junto.
      await h.prisma.userPageRole.deleteMany({ where: { pageId } });
      const lost = await bearer(a.token).get(`/api/pages/${pageId}/incidents`);
      expect(lost.status).toBe(401);
      expect(lost.body.message).toBe('invalid_api_token');

      const b = await createToken(owner, { name: 'Temp', role: 'viewer', expiresInDays: 1 });
      await h.prisma.apiToken.update({
        where: { id: b.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await bearer(b.token).get(`/api/pages/${pageId}/incidents`)).status).toBe(401);

      const c = await createToken(owner, { name: 'Revogar', role: 'viewer' });
      expect((await owner.delete(`/api/pages/${pageId}/api-tokens/${c.id}`)).status).toBe(204);
      expect((await bearer(c.token).get(`/api/pages/${pageId}/incidents`)).status).toBe(401);
      expect((await bearer('sp_invalido').get(`/api/pages/${pageId}/incidents`)).status).toBe(401);
    });

    it('Operador não gerencia tokens; token de Leitor lê página privada', async () => {
      await createUser(h.prisma, { email: 'op@example.com', roles: { [pageId]: 'operator' } });
      const op = await loginAs(h, 'op@example.com');
      expect((await op.get(`/api/pages/${pageId}/api-tokens`)).status).toBe(403);

      await owner.patch(`/api/pages/${pageId}`, { visibility: 'private' });
      expect((await h.anon.get('/api/public/pages/acme')).status).toBe(401);
      const { token } = await createToken(owner, { name: 'Leitura', role: 'viewer' });
      expect((await bearer(token).get('/api/public/pages/acme')).status).toBe(200);
    });
  });

  describe('feeds, JSON, selo e widget', () => {
    async function incident(title: string, status = 'investigating') {
      const res = await owner.post(`/api/pages/${pageId}/incidents`, {
        title,
        impact: 'major',
        status,
        body: 'Linha 1\nLinha <b>2</b>',
        notify: false,
        components: [{ componentId: apiId, status: 'major_outage' }],
      });
      expect(res.status).toBe(201);
      return res.body.id as string;
    }

    it('status.json compacto com CORS na página pública', async () => {
      const id = await incident('API fora');
      const res = await h.anon.get('/api/public/pages/acme/status.json');
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.body).toMatchObject({
        page: { slug: 'acme', url: 'https://status.acme.test/p/acme' },
        status: 'major_outage',
        components: [{ name: 'API', status: 'major_outage', group: null }],
        incidents: [
          { id, title: 'API fora', url: `https://status.acme.test/p/acme/incidents/${id}` },
        ],
      });
    });

    it('feeds Atom e RSS válidos, com texto escapado e idioma escolhido', async () => {
      await incident('Lentidão & erros <x>');
      const atom = await h.anon.get('/api/public/pages/acme/feed.atom');
      expect(atom.headers['content-type']).toContain('application/atom+xml');
      expect(atom.text).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="pt-BR">');
      expect(atom.text).toContain('[Investigando] Lentidão &amp; erros &lt;x&gt;');
      expect(atom.text).not.toContain('<b>2</b>');
      expect(atom.text).toContain('https://status.acme.test/api/public/pages/acme/feed.atom');
      const rss = await h.anon.get('/api/public/pages/acme/feed.rss?lang=en-US');
      expect(rss.headers['content-type']).toContain('application/rss+xml');
      expect(rss.text).toContain('<language>en-US</language>');
      expect(rss.text).toContain('[Investigating]');
      expect(rss.text).toContain('Acme — status history');
    });

    it('selo SVG com o status e widget que insere o iframe', async () => {
      await incident('API fora');
      const badge = await h.anon.get('/api/public/pages/acme/badge.svg?lang=en-US');
      expect(badge.headers['content-type']).toContain('image/svg+xml');
      expect(badge.headers['content-security-policy']).toContain("default-src 'none'");
      const svg = badge.body instanceof Buffer ? badge.body.toString() : badge.text;
      expect(svg).toContain('Major outage');
      expect(svg).toContain('#cf222e');
      const widget = await h.anon.get('/api/public/pages/acme/widget.js');
      expect(widget.headers['content-type']).toContain('application/javascript');
      expect(widget.text).toContain("'/p/' + \"acme\" + '/embed'");
    });

    it('página privada: sem acesso, sem feed; sem CORS', async () => {
      await owner.patch(`/api/pages/${pageId}`, { visibility: 'private' });
      expect((await h.anon.get('/api/public/pages/acme/feed.atom')).status).toBe(401);
      expect((await h.anon.get('/api/public/pages/acme/badge.svg')).status).toBe(401);
      const own = await owner.get('/api/public/pages/acme/status.json');
      expect(own.status).toBe(200);
      expect(own.headers['access-control-allow-origin']).toBeUndefined();
      expect(own.headers['cache-control']).toBe('private, no-store');
      // Página privada não é incorporável.
      expect((await owner.get('/api/public/pages/acme/widget.js')).status).toBe(404);
    });
  });

  describe('webhooks de saída por evento', () => {
    it('canal com eventos específicos só recebe esses eventos', async () => {
      const ch = await owner.post(`/api/pages/${pageId}/notification-channels`, {
        kind: 'webhook',
        name: 'Só resolvidos',
        events: ['incident_resolved'],
        config: { url: 'https://hooks.interno.test/status', secret: 'segredo' },
      });
      expect(ch.status).toBe(201);
      const created = await owner.post(`/api/pages/${pageId}/incidents`, {
        title: 'Queda',
        impact: 'major',
        status: 'investigating',
        body: 'Investigando.',
        notify: true,
        components: [{ componentId: apiId, status: 'major_outage' }],
      });
      await owner.post(`/api/pages/${pageId}/incidents/${created.body.id}/updates`, {
        status: 'resolved',
        body: 'Resolvido.',
        notify: true,
        components: [{ componentId: apiId, status: 'operational' }],
      });
      const events = await h.prisma.notificationEvent.findMany({ orderBy: { createdAt: 'asc' } });
      const deliveries: Record<string, number> = {};
      for (const e of events) deliveries[e.type] = (await fanOutEvent(h.prisma, e.id)).length;
      expect(deliveries).toEqual({ incident_created: 0, incident_resolved: 1 });
    });
  });

  describe('exportar e importar configuração', () => {
    const csrf = { 'X-Requested-With': 'status-page' };
    const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);

    /** Página completa: grupo, componente, logo no tema, templates, canal, monitor e integração. */
    async function seedConfig() {
      const group = await owner.post(`/api/pages/${pageId}/groups`, { name: 'Plataforma' });
      await owner.put(`/api/pages/${pageId}/layout`, {
        groups: [group.body.id],
        components: [{ componentId: apiId, groupId: group.body.id }],
      });
      const upload = await owner.agent
        .post(`/api/pages/${pageId}/uploads`)
        .set(csrf)
        .attach('file', PNG, 'logo.png');
      expect(upload.status).toBe(201);
      const theme = await owner.put(`/api/pages/${pageId}/theme/draft`, {
        ...DEFAULT_THEME,
        logoId: upload.body.id,
        customCss: `.hero { background: url(/api/public/uploads/${upload.body.id}); }`,
      });
      expect(theme.status).toBe(200);
      await owner.post(`/api/pages/${pageId}/theme/publish`);
      const tpl = await owner.post(`/api/pages/${pageId}/templates`, {
        name: 'Queda',
        title: 'API fora',
        body: 'Investigando.',
        componentIds: [apiId],
      });
      await owner.put(`/api/pages/${pageId}/notification-templates`, {
        channel: 'all',
        event: 'incident_created',
        locale: 'pt-BR',
        subject: 'Alerta: {{incident.title}}',
        body: '{{update.body}}',
      });
      expect(
        (
          await owner.post(`/api/pages/${pageId}/notification-channels`, {
            kind: 'webhook',
            name: 'SIEM',
            config: { url: 'https://hooks.interno.test/siem', secret: 'segredo-do-canal' },
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await owner.post(`/api/pages/${pageId}/monitors`, {
            name: 'API HTTP',
            type: 'http',
            target: 'https://api.acme.test/health',
            componentId: apiId,
            templateId: tpl.body.id,
            headers: { Authorization: 'Bearer token-do-monitor' },
            config: { keyword: 'ok' },
          })
        ).status,
      ).toBe(201);
      const src = await owner.post(`/api/pages/${pageId}/inbound-sources`, {
        name: 'Prometheus',
        kind: 'alertmanager',
        hmacSecret: 'segredo-hmac',
      });
      await owner.put(`/api/pages/${pageId}/inbound-sources/${src.body.id}/rules`, {
        rules: [
          {
            matchField: 'label:service',
            pattern: 'api*',
            componentId: apiId,
            status: 'major_outage',
          },
        ],
      });
      const secrets = h.app.get(SecretsService);
      await h.prisma.ldapProvider.create({
        data: {
          name: 'AD Corp',
          kind: 'active_directory',
          host: 'dc1.corp.test',
          port: 636,
          security: 'ldaps',
          bindDn: 'CN=svc,DC=corp,DC=test',
          bindPasswordEnc: secrets.encrypt('senha-do-bind'),
          baseDn: 'DC=corp,DC=test',
          userFilter: '(sAMAccountName={username})',
          usernameAttribute: 'sAMAccountName',
          emailAttribute: 'mail',
          nameAttribute: 'displayName',
          uniqueIdAttribute: 'objectGUID',
          mappings: { create: [{ groupDn: 'CN=Ops,DC=corp,DC=test', pageId, role: 'operator' }] },
        },
      });
      return { uploadId: upload.body.id as string, sourceUrl: src.body.url as string };
    }

    const exportConfig = (body: object = {}) =>
      owner.post('/api/admin/config/export', body).then((r) => {
        expect(r.status).toBe(200);
        return r.body as Record<string, unknown>;
      });
    const importConfig = (by: Client, file: object, fields: Record<string, string> = {}) => {
      let req = by.agent
        .post('/api/admin/config/import')
        .set(csrf)
        .attach('file', Buffer.from(JSON.stringify(file)), 'config.json');
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req;
    };

    it('exporta sem segredos em texto; com senha, reimporta tudo numa instalação vazia', async () => {
      const original = await seedConfig();
      const file = await exportConfig({ password: 'senha-da-exportacao' });
      const text = JSON.stringify(file);
      for (const secret of [
        'segredo-do-canal',
        'token-do-monitor',
        'segredo-hmac',
        'senha-do-bind',
        'hooks.interno.test',
      ]) {
        expect(text).not.toContain(secret);
      }
      const plain = await exportConfig();
      expect(plain.secrets).toBeNull();
      expect(JSON.stringify(plain)).not.toContain('segredo');

      // Instalação nova.
      await resetState(h.prisma, h.redis);
      await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
      owner = await loginAs(h, 'dono@example.com');

      const wrong = await importConfig(owner, file, { password: 'errada-errada', dryRun: 'false' });
      expect(wrong.body.message).toBe('invalid_password');

      const preview = await importConfig(owner, file, { password: 'senha-da-exportacao' });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ dryRun: true, mode: 'merge', withSecrets: true });
      expect(preview.body.pages[0]).toMatchObject({
        slug: 'acme',
        action: 'create',
        changes: {
          components: { created: 1 },
          groups: { created: 1 },
          uploads: { created: 1 },
          themes: { created: 2 },
          channels: { created: 1 },
          monitors: { created: 1 },
          inboundSources: { created: 1 },
        },
      });
      // Simulação não grava nada.
      expect(await h.prisma.page.count()).toBe(0);

      const applied = await importConfig(owner, file, {
        password: 'senha-da-exportacao',
        dryRun: 'false',
      });
      expect(applied.body.dryRun).toBe(false);
      expect(applied.body.warnings).toEqual([]);

      const page = await h.prisma.page.findUniqueOrThrow({ where: { slug: 'acme' } });
      const component = await h.prisma.pageComponent.findFirstOrThrow({
        where: { pageId: page.id },
        include: { component: true, group: true },
      });
      expect(component.component.name).toBe('API');
      expect(component.group?.name).toBe('Plataforma');

      // Tema aponta para o novo arquivo (o mesmo conteúdo) e ele é servido.
      const theme = await h.anon.get('/api/public/pages/acme');
      const logoId = theme.body.page.theme.logoId as string;
      expect(logoId).not.toBe(original.uploadId);
      expect(theme.body.page.theme.customCss).toContain(logoId);
      const logo = await h.anon.get(`/api/public/uploads/${logoId}`);
      expect(logo.status).toBe(200);

      const secrets = h.app.get(SecretsService);
      const channel = await h.prisma.notificationChannel.findFirstOrThrow();
      expect(JSON.parse(secrets.decrypt(channel.configEnc))).toEqual({
        url: 'https://hooks.interno.test/siem',
        secret: 'segredo-do-canal',
      });
      const monitor = await h.prisma.monitor.findFirstOrThrow({ include: { template: true } });
      expect(monitor.componentId).toBe(component.componentId);
      expect(monitor.template?.name).toBe('Queda');
      expect(JSON.parse(secrets.decrypt(monitor.headersEnc!))).toEqual({
        Authorization: 'Bearer token-do-monitor',
      });
      const source = await h.prisma.inboundSource.findFirstOrThrow({ include: { rules: true } });
      expect(secrets.decrypt(source.hmacSecretEnc!)).toBe('segredo-hmac');
      expect(source.rules[0]).toMatchObject({
        componentId: component.componentId,
        pattern: 'api*',
      });
      // A URL da integração é nova.
      const sources = await owner.get(`/api/pages/${page.id}/inbound-sources`);
      expect(sources.body[0].url).not.toBe(original.sourceUrl);
      const provider = await h.prisma.ldapProvider.findFirstOrThrow({
        include: { mappings: true },
      });
      expect(secrets.decrypt(provider.bindPasswordEnc)).toBe('senha-do-bind');
      expect(provider.mappings[0]).toMatchObject({ pageId: page.id, role: 'operator' });
      expect(await h.prisma.notificationTemplate.count()).toBe(1);

      // Reimportar (mesclar) não duplica nada.
      const again = await importConfig(owner, file, {
        password: 'senha-da-exportacao',
        dryRun: 'false',
      });
      expect(again.body.pages[0].action).toBe('update');
      expect(await h.prisma.component.count()).toBe(1);
      expect(await h.prisma.monitor.count()).toBe(1);
      expect(await h.prisma.upload.count()).toBe(1);
      expect(await h.prisma.ldapProvider.count()).toBe(1);
    });

    it('substituir remove o que não está no arquivo; sem senha, canais novos ficam de fora', async () => {
      await seedConfig();
      await owner.post(`/api/pages/${pageId}/templates`, { name: 'Extra', title: 'X', body: 'Y' });
      const file = (await exportConfig()) as { pages: { templates: { name: string }[] }[] };
      file.pages[0]!.templates = file.pages[0]!.templates.filter((t) => t.name !== 'Extra');

      const preview = await importConfig(owner, file, { mode: 'replace' });
      expect(preview.body.pages[0].removed).toEqual(['template:Extra']);
      expect(await h.prisma.incidentTemplate.count()).toBe(2);
      const applied = await importConfig(owner, file, { mode: 'replace', dryRun: 'false' });
      expect(applied.body.pages[0].changes.templates.deleted).toBe(1);
      expect(await h.prisma.incidentTemplate.count()).toBe(1);
      // Canal existente mantém a configuração atual mesmo sem a senha.
      expect(applied.body.pages[0].changes.channels.updated).toBe(1);

      await resetState(h.prisma, h.redis);
      await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
      owner = await loginAs(h, 'dono@example.com');
      const fresh = await importConfig(owner, file, { dryRun: 'false' });
      expect(fresh.body.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: 'channel_needs_secrets', detail: 'SIEM' }),
          expect.objectContaining({ message: 'ldap_disabled_without_password' }),
        ]),
      );
      expect(await h.prisma.notificationChannel.count()).toBe(0);
      expect((await h.prisma.ldapProvider.findFirstOrThrow()).enabled).toBe(false);
    });

    it('só o Dono, pela sessão; arquivo inválido é recusado', async () => {
      await createUser(h.prisma, { email: 'admin@example.com', roles: { [pageId]: 'admin' } });
      const admin = await loginAs(h, 'admin@example.com');
      expect((await admin.post('/api/admin/config/export', {})).status).toBe(403);
      const bad = await importConfig(owner, { format: 'outro' });
      expect(bad.body.message).toBe('invalid_config_file');
      const history = await owner.get(`/api/pages/${pageId}/export/history`);
      expect(history.status).toBe(200);
      expect(history.headers['content-disposition']).toContain('attachment');
      expect(history.body).toMatchObject({ format: 'status-page-history', page: { slug: 'acme' } });
    });
  });

  describe('OpenAPI', () => {
    it('documenta as rotas públicas e de página, sem rotas de sessão', async () => {
      const res = await h.anon.get('/api/docs/openapi.json');
      expect(res.status).toBe(200);
      const doc = res.body as {
        openapi: string;
        paths: Record<string, Record<string, { tags: string[]; security?: unknown[] }>>;
        webhooks: Record<string, unknown>;
        components: { securitySchemes: Record<string, unknown> };
      };
      expect(doc.openapi).toBe('3.1.0');
      const paths = Object.keys(doc.paths);
      expect(paths).toContain('/api/public/pages/{slug}');
      expect(paths).toContain('/api/pages/{pageId}/incidents');
      expect(paths.some((p) => p.startsWith('/api/auth'))).toBe(false);
      expect(paths.some((p) => p.includes('api-tokens'))).toBe(false);
      for (const hidden of ['/team', '/export/history', 'force-verify', 'subscribers/export.csv']) {
        expect(
          paths.some((p) => p.includes(hidden)),
          hidden,
        ).toBe(false);
      }
      const create = doc.paths['/api/pages/{pageId}/incidents']!.post as unknown as {
        security: unknown[];
        requestBody: { content: Record<string, { schema: { properties: object } }> };
      };
      expect(create.security).toEqual([{ token: [] }]);
      expect(
        Object.keys(create.requestBody.content['application/json']!.schema.properties),
      ).toEqual(expect.arrayContaining(['title', 'impact', 'components']));
      expect(doc.webhooks.notificationEvent).toBeDefined();
      expect(doc.components.securitySchemes.token).toBeDefined();

      const ui = await h.anon.get('/api/docs');
      expect(ui.status).toBe(200);
      expect(ui.text).toContain('swagger');
      // A interface funciona sem scripts inline (a CSP da rota não libera).
      expect(ui.text).not.toMatch(/<script>(?!\s*<\/script>)[^<]+<\/script>/);
      expect(ui.headers['content-security-policy']).toContain("default-src 'self'");
      const json = await h.anon.get('/api/public/pages/acme');
      expect(json.headers['content-security-policy']).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
    });
  });
});
