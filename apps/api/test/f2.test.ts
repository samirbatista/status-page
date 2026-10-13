import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME, type Theme } from '@status-page/shared';
import { DomainsService } from '../src/domains/domains.service.js';
import {
  createHarness,
  createUser,
  loginAs,
  resetState,
  type Client,
  type Harness,
} from './support/harness.js';

// PNG 1x1 transparente.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const SAFE_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
);
const EVIL_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
);
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]);

function upload(c: Client, pageId: string, data: Buffer, name: string) {
  return c.agent
    .post(`/api/pages/${pageId}/uploads`)
    .set('X-Requested-With', 'status-page')
    .attach('file', data, name);
}

describe('F2: tema, uploads, domínios e páginas privadas', () => {
  let h: Harness;
  let owner: Client;
  let pageId: string;

  beforeAll(async () => {
    h = await createHarness();
  });

  beforeEach(async () => {
    await resetState(h.prisma, h.redis);
    await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
    owner = await loginAs(h, 'dono@example.com');
    pageId = (await owner.post('/api/pages', { slug: 'acme', name: 'Acme' })).body.id;
  });

  afterAll(() => h.close());

  describe('tema', () => {
    const theme = (overrides: Partial<Theme> = {}): Theme => ({ ...DEFAULT_THEME, ...overrides });

    it('rascunho, pré-visualização e publicação', async () => {
      const initial = await owner.get(`/api/pages/${pageId}/theme`);
      expect(initial.body).toMatchObject({ draft: DEFAULT_THEME, hasUnpublishedChanges: false });

      const draft = theme({
        mode: 'dark',
        colors: { ...DEFAULT_THEME.colors, brand: '#ff0000' },
        customCss: '@import url(https://evil.example/x.css); .x{color:red}',
        customHeaderHtml: '<p onclick="x()">Olá<script>alert(1)</script></p>',
      });
      const saved = await owner.put(`/api/pages/${pageId}/theme/draft`, draft);
      expect(saved.status).toBe(200);
      expect(saved.body.removedCss).toHaveLength(1);
      expect(saved.body.theme.customCss).not.toContain('@import');
      expect(saved.body.theme.customHeaderHtml).toBe('<p>Olá</p>');

      // Público continua vendo o tema publicado; o Admin pode pré-visualizar o rascunho.
      expect((await h.anon.get('/api/public/pages/acme')).body.page.theme.mode).toBe('auto');
      expect((await h.anon.get('/api/public/pages/acme?preview=draft')).body.page.theme.mode).toBe(
        'auto',
      );
      const preview = await owner.get('/api/public/pages/acme?preview=draft');
      expect(preview.body.page).toMatchObject({ preview: true, theme: { mode: 'dark' } });
      expect(preview.headers['cache-control']).toBe('private, no-store');

      expect((await owner.post(`/api/pages/${pageId}/theme/publish`)).status).toBe(200);
      const pub = await h.anon.get('/api/public/pages/acme');
      expect(pub.body.page.theme).toMatchObject({ mode: 'dark', colors: { brand: '#ff0000' } });

      const audit = await h.prisma.auditLog.findMany({
        where: { action: { startsWith: 'theme.' } },
      });
      expect(audit.map((a) => a.action).sort()).toEqual(['theme.publish', 'theme.save_draft']);
    });

    it('recusa cores inválidas e CSS com erro de sintaxe', async () => {
      const bad = await owner.put(`/api/pages/${pageId}/theme/draft`, {
        ...DEFAULT_THEME,
        colors: { ...DEFAULT_THEME.colors, brand: 'red;}body{x:y' },
      });
      expect(bad.status).toBe(400);
      const css = await owner.put(
        `/api/pages/${pageId}/theme/draft`,
        theme({ customCss: '.a{color:red' }),
      );
      expect(css.status).toBe(400);
      expect(css.body.message).toBe('invalid_css');
    });

    it('descartar volta o rascunho ao publicado', async () => {
      await owner.put(`/api/pages/${pageId}/theme/draft`, theme({ mode: 'light' }));
      const res = await owner.post(`/api/pages/${pageId}/theme/discard`);
      expect(res.body).toMatchObject({ hasUnpublishedChanges: false, draft: { mode: 'auto' } });
    });

    it('só Admins editam o tema', async () => {
      await createUser(h.prisma, { email: 'op@example.com', roles: { [pageId]: 'operator' } });
      const op = await loginAs(h, 'op@example.com');
      expect((await op.put(`/api/pages/${pageId}/theme/draft`, DEFAULT_THEME)).status).toBe(403);
    });
  });

  describe('uploads', () => {
    it('aceita imagens e fontes pelo conteúdo real e serve com cabeçalhos seguros', async () => {
      const png = await upload(owner, pageId, PNG, 'logo.png');
      expect(png.status).toBe(201);
      expect(png.body).toMatchObject({ kind: 'image', contentType: 'image/png', size: PNG.length });

      const served = await h.anon.get(`/api/public/uploads/${png.body.id}`);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['content-security-policy']).toContain('sandbox');
      expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);

      const svg = await upload(owner, pageId, SAFE_SVG, 'logo.svg');
      expect(svg.body.contentType).toBe('image/svg+xml');
      const font = await upload(owner, pageId, WOFF2, 'fonte.woff2');
      expect(font.body).toMatchObject({ kind: 'font', contentType: 'font/woff2' });
    });

    it('recusa arquivos falsificados, SVG perigoso e arquivos grandes', async () => {
      const fake = await upload(owner, pageId, Buffer.from('<html>oi</html>'), 'logo.png');
      expect(fake.status).toBe(400);
      expect(fake.body.message).toBe('unsupported_file_type');
      const evil = await upload(owner, pageId, EVIL_SVG, 'x.svg');
      expect(evil.body.message).toBe('unsafe_svg');
      const big = await upload(
        owner,
        pageId,
        Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]),
        'big.png',
      );
      expect(big.status).toBe(413);
    });

    it('tema só referencia arquivos da página e do tipo certo; arquivo em uso não é apagado', async () => {
      const png = (await upload(owner, pageId, PNG, 'logo.png')).body;
      const asFont = await owner.put(`/api/pages/${pageId}/theme/draft`, {
        ...DEFAULT_THEME,
        font: { source: 'upload', family: 'Minha', uploadId: png.id },
      });
      expect(asFont.body.message).toBe('invalid_upload');

      const other = (await owner.post('/api/pages', { slug: 'outra', name: 'Outra' })).body;
      const foreign = (await upload(owner, other.id, PNG, 'x.png')).body;
      const cross = await owner.put(`/api/pages/${pageId}/theme/draft`, {
        ...DEFAULT_THEME,
        logoId: foreign.id,
      });
      expect(cross.body.message).toBe('invalid_upload');

      await owner.put(`/api/pages/${pageId}/theme/draft`, { ...DEFAULT_THEME, logoId: png.id });
      expect((await owner.delete(`/api/pages/${pageId}/uploads/${png.id}`)).status).toBe(409);
      await owner.put(`/api/pages/${pageId}/theme/draft`, DEFAULT_THEME);
      expect((await owner.delete(`/api/pages/${pageId}/uploads/${png.id}`)).status).toBe(204);
      expect((await h.anon.get(`/api/public/uploads/${png.id}`)).status).toBe(404);
    });
  });

  describe('domínios próprios', () => {
    it('verifica pelo registro TXT e passa a resolver o host', async () => {
      const created = await owner.post(`/api/pages/${pageId}/domains`, {
        hostname: 'Status.Acme.com',
      });
      expect(created.status).toBe(201);
      const { record } = created.body;
      expect(record).toMatchObject({ type: 'TXT', name: '_status-page.status.acme.com' });

      const domains = h.app.get(DomainsService);
      domains.resolver = async () => [['outro-valor']];
      const failed = await owner.post(`/api/pages/${pageId}/domains/${created.body.id}/verify`);
      expect(failed.status).toBe(400);
      expect(failed.body.record.value).toBe(record.value);
      expect((await h.anon.get('/api/public/resolve-host?host=status.acme.com')).status).toBe(404);
      expect((await h.anon.get('/api/internal/tls-ask?domain=status.acme.com')).status).toBe(404);

      domains.resolver = async (name) => (name === record.name ? [[record.value]] : []);
      const ok = await owner.post(`/api/pages/${pageId}/domains/${created.body.id}/verify`);
      expect(ok.status).toBe(200);
      expect(ok.body.verifiedAt).toBeTruthy();

      const resolved = await h.anon.get('/api/public/resolve-host?host=STATUS.acme.com:443');
      expect(resolved.body).toEqual({ slug: 'acme' });
      expect((await h.anon.get('/api/internal/tls-ask?domain=status.acme.com')).status).toBe(200);

      expect(
        (await owner.post(`/api/pages/${pageId}/domains`, { hostname: 'status.acme.com' })).status,
      ).toBe(409);
      expect(
        (await owner.post(`/api/pages/${pageId}/domains`, { hostname: 'http://x' })).status,
      ).toBe(400);
    });

    it('verificação manual é só do Dono', async () => {
      await createUser(h.prisma, { email: 'admin@example.com', roles: { [pageId]: 'admin' } });
      const admin = await loginAs(h, 'admin@example.com');
      const domain = (
        await admin.post(`/api/pages/${pageId}/domains`, { hostname: 'intra.acme.local' })
      ).body;
      expect(
        (await admin.post(`/api/pages/${pageId}/domains/${domain.id}/force-verify`)).status,
      ).toBe(403);
      expect(
        (await owner.post(`/api/pages/${pageId}/domains/${domain.id}/force-verify`)).status,
      ).toBe(200);
      expect((await h.anon.get('/api/public/resolve-host?host=intra.acme.local')).body).toEqual({
        slug: 'acme',
      });
    });
  });

  describe('páginas privadas', () => {
    const setAccess = (privateAccess: string, allowedCidrs: string[] = []) =>
      owner.patch(`/api/pages/${pageId}`, { visibility: 'private', privateAccess, allowedCidrs });

    it('login: exige papel na página', async () => {
      await setAccess('login');
      expect((await h.anon.get('/api/public/pages/acme')).body.message).toBe('login_required');

      await createUser(h.prisma, { email: 'leitor@example.com', roles: { [pageId]: 'viewer' } });
      expect(
        (await (await loginAs(h, 'leitor@example.com')).get('/api/public/pages/acme')).status,
      ).toBe(200);

      await createUser(h.prisma, { email: 'estranho@example.com' });
      const stranger = await (
        await loginAs(h, 'estranho@example.com')
      ).get('/api/public/pages/acme');
      expect(stranger.status).toBe(403);
      expect(stranger.body.message).toBe('private_page_forbidden');
    });

    it('ip: libera só as redes cadastradas', async () => {
      await setAccess('ip', ['127.0.0.1/32', '::1/128']);
      const res = await h.anon.get('/api/public/pages/acme');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');

      await setAccess('ip', ['10.0.0.0/8']);
      const denied = await h.anon.get('/api/public/pages/acme');
      expect(denied.status).toBe(403);
      expect(denied.body.message).toBe('ip_not_allowed');
      // Nem quem tem papel na página entra de fora da rede nesse modo.
      expect((await owner.get('/api/public/pages/acme')).status).toBe(403);
    });

    it('combinações login_or_ip e login_and_ip', async () => {
      await setAccess('login_or_ip', ['10.0.0.0/8']);
      expect((await h.anon.get('/api/public/pages/acme')).status).toBe(401);
      expect((await owner.get('/api/public/pages/acme')).status).toBe(200);

      await setAccess('login_and_ip', ['127.0.0.1/32', '::1/128']);
      expect((await h.anon.get('/api/public/pages/acme')).status).toBe(401);
      expect((await owner.get('/api/public/pages/acme')).status).toBe(200);
    });

    it('arquivos de página privada seguem a mesma regra', async () => {
      const png = (await upload(owner, pageId, PNG, 'logo.png')).body;
      await setAccess('login');
      expect((await h.anon.get(`/api/public/uploads/${png.id}`)).status).toBe(401);
      const own = await owner.get(`/api/public/uploads/${png.id}`);
      expect(own.status).toBe(200);
      expect(own.headers['cache-control']).toBe('private, max-age=3600');
    });

    it('recusa CIDR inválido', async () => {
      const res = await setAccess('ip', ['10.0.0.0/33']);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ message: 'invalid_cidr', invalid: ['10.0.0.0/33'] });
    });
  });
});
