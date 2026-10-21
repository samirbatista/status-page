import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runDueChecks } from '@status-page/core';
import { fanOutEvent, processDelivery } from '@status-page/notifiers';
import { NotifyService } from '../src/infra/notify.service.js';
import { SecretsService } from '../src/infra/secrets.service.js';
import { FakeSmtp } from './support/fakes.js';
import {
  type Client,
  createHarness,
  createUser,
  loginAs,
  resetState,
  type Harness,
} from './support/harness.js';

/** Serviço "monitorado": responde 200 ou 503 conforme `up`. */
class Target {
  up = true;
  hits = 0;
  lastHeaders: Record<string, string | string[] | undefined> = {};
  private server: Server | null = null;
  url = '';

  async start() {
    this.server = createServer((req, res) => {
      this.hits++;
      this.lastHeaders = req.headers;
      res.writeHead(this.up ? 200 : 503, { 'content-type': 'text/plain' });
      res.end(this.up ? 'tudo certo' : 'fora');
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}/health`;
  }

  async stop() {
    await new Promise<void>((r) => this.server?.close(() => r()) ?? r());
  }
}

const smtp = new FakeSmtp();
const target = new Target();

describe('F5: monitoramento e automação', () => {
  let h: Harness;
  let owner: Client;
  let pageId: string;
  let apiId: string;

  /** Uma volta do agendador do serviço monitor (todos os monitores vencidos). */
  async function tick() {
    await h.prisma.monitor.updateMany({ data: { nextCheckAt: new Date(Date.now() - 1000) } });
    return runDueChecks(h.prisma, h.app.get(SecretsService));
  }

  async function runQueue() {
    const ctx = h.app.get(NotifyService).context;
    const events = await h.prisma.notificationEvent.findMany({ where: { fannedOutAt: null } });
    for (const event of events) {
      for (const id of await fanOutEvent(h.prisma, event.id)) await processDelivery(ctx, id);
    }
    return events.map((e) => e.type);
  }

  /** Inscrição por e-mail confirmada pelo código (como na página pública). */
  async function subscriber(email: string) {
    const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
      kind: 'email',
      target: email,
      locale: 'pt-BR',
      consent: true,
    });
    const code = /(\d{6}) para confirmar/.exec(smtp.lastTo(email) ?? '')?.[1];
    const confirm = await h.anon.post(
      `/api/public/subscriptions/pending/${res.body.pendingToken}/confirm`,
      { code },
    );
    expect(confirm.status).toBe(200);
    smtp.messages.length = 0;
  }

  async function componentStatus(id = apiId) {
    return (await h.prisma.component.findUniqueOrThrow({ where: { id } })).status;
  }

  function monitorBody(extra: object = {}) {
    return {
      name: 'API pública',
      type: 'http',
      target: target.url,
      componentId: apiId,
      intervalSeconds: 30,
      timeoutMs: 2000,
      failureThreshold: 2,
      recoveryThreshold: 1,
      config: {},
      ...extra,
    };
  }

  beforeAll(async () => {
    await smtp.start();
    await target.start();
    h = await createHarness({ PUBLIC_URL: 'https://status.acme.test' });
  });

  beforeEach(async () => {
    await resetState(h.prisma, h.redis);
    target.up = true;
    smtp.messages.length = 0;
    await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
    owner = await loginAs(h, 'dono@example.com');
    pageId = (await owner.post('/api/pages', { slug: 'acme', name: 'Acme' })).body.id;
    apiId = (await owner.post(`/api/pages/${pageId}/components`, { name: 'API' })).body.id;
    await owner.put('/api/notifications/settings/smtp', {
      enabled: true,
      host: '127.0.0.1',
      port: smtp.port,
      security: 'none',
      username: '',
      from: 'Status <status@acme.test>',
    });
  });

  afterAll(async () => {
    await h.close();
    await smtp.stop();
    await target.stop();
  });

  describe('monitores', () => {
    it('Admin configura; cabeçalhos ficam cifrados e não voltam', async () => {
      const res = await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ headers: { Authorization: 'Bearer segredo-do-monitor' } }),
      );
      expect(res.status).toBe(201);
      expect(res.body.headerNames).toEqual(['Authorization']);
      expect(JSON.stringify(res.body)).not.toContain('segredo-do-monitor');
      expect(res.body.config).toMatchObject({ method: 'GET', expectedStatus: '200-399' });
      const stored = await h.prisma.monitor.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.headersEnc).not.toContain('segredo');

      // A checagem envia o cabeçalho salvo.
      await tick();
      expect(target.lastHeaders.authorization).toBe('Bearer segredo-do-monitor');

      // Edição sem `headers` mantém os atuais.
      const upd = await owner.put(
        `/api/pages/${pageId}/monitors/${res.body.id}`,
        monitorBody({ name: 'API v2' }),
      );
      expect(upd.body.headerNames).toEqual(['Authorization']);

      await createUser(h.prisma, { email: 'op@example.com', roles: { [pageId]: 'operator' } });
      const op = await loginAs(h, 'op@example.com');
      expect((await op.get(`/api/pages/${pageId}/monitors`)).status).toBe(200);
      expect((await op.post(`/api/pages/${pageId}/monitors`, monitorBody())).status).toBe(403);
    });

    it('valida configuração por tipo e intervalo mínimo', async () => {
      const bad = await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ type: 'tcp', target: 'db.interno', config: {} }),
      );
      expect(bad.status).toBe(400);
      const fast = await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ intervalSeconds: 5 }),
      );
      expect(fast.status).toBe(400);
      const url = await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ target: 'ftp://x' }),
      );
      expect(url.status).toBe(400);
    });

    it('"Testar agora" roda a checagem sem gravar', async () => {
      const ok = await owner.post(`/api/pages/${pageId}/monitors/test`, monitorBody());
      expect(ok.body).toMatchObject({ ok: true, error: null });
      target.up = false;
      const down = await owner.post(`/api/pages/${pageId}/monitors/test`, monitorBody());
      expect(down.body).toMatchObject({ ok: false, error: 'HTTP 503' });
      const tcp = await owner.post(
        `/api/pages/${pageId}/monitors/test`,
        monitorBody({
          type: 'tcp',
          target: '127.0.0.1',
          config: { port: Number(new URL(target.url).port) },
        }),
      );
      expect(tcp.body.ok).toBe(true);
      expect(await h.prisma.monitorCheckResult.count()).toBe(0);
    });
  });

  describe('modo automático', () => {
    it('serviço cai: abre incidente pelo template, notifica e resolve ao voltar', async () => {
      await subscriber('cliente@acme.test');
      const template = await owner.post(`/api/pages/${pageId}/templates`, {
        name: 'Queda da API',
        title: 'API indisponível',
        body: 'Detectamos indisponibilidade na API e estamos atuando.',
        impact: 'major',
        status: 'investigating',
        componentIds: [apiId],
        componentStatus: 'major_outage',
      });
      expect(template.status).toBe(201);
      await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ templateId: template.body.id }),
      );

      expect((await tick()).checked).toBe(1);
      expect(await componentStatus()).toBe('operational');

      target.up = false;
      await tick(); // 1ª falha: abaixo do limite
      expect(await componentStatus()).toBe('operational');
      const { transitions } = await tick(); // 2ª falha: cai
      expect(transitions).toEqual([
        expect.objectContaining({ to: 'down', outcome: 'incident_opened' }),
      ]);
      expect(await componentStatus()).toBe('major_outage');
      const incident = await h.prisma.incident.findFirstOrThrow({ where: { pageId } });
      expect(incident).toMatchObject({ title: 'API indisponível', status: 'investigating' });

      expect(await runQueue()).toEqual(['incident_created']);
      expect(smtp.lastTo('cliente@acme.test')).toContain('API indispon');

      // Continua fora: não abre outro incidente.
      await tick();
      expect(await h.prisma.incident.count()).toBe(1);

      target.up = true;
      const back = await tick();
      expect(back.transitions[0]).toMatchObject({ to: 'up', outcome: 'incident_resolved' });
      expect(await componentStatus()).toBe('operational');
      const resolved = await h.prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
      expect(resolved.status).toBe('resolved');
      expect(await runQueue()).toEqual(['incident_resolved']);
      expect(smtp.lastTo('cliente@acme.test')).toContain('voltou a operar');

      const monitor = await h.prisma.monitor.findFirstOrThrow();
      expect(monitor.state).toBe('up');
      expect(await h.prisma.monitorCheckResult.count()).toBe(5);
    });

    it('sem template: muda só o status do componente e avisa os assinantes', async () => {
      await subscriber('cliente@acme.test');
      await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ failureThreshold: 1, failureStatus: 'partial_outage' }),
      );
      target.up = false;
      await tick();
      expect(await componentStatus()).toBe('partial_outage');
      expect(await h.prisma.incident.count()).toBe(0);
      expect(await runQueue()).toEqual(['component_status_changed']);
      const mail = smtp.lastTo('cliente@acme.test')!;
      expect(mail).toContain('Falha detectada automaticamente');
      expect(mail).toContain('Interrup');

      target.up = true;
      await tick();
      expect(await componentStatus()).toBe('operational');
      expect(await runQueue()).toEqual(['component_status_changed']);
    });

    it('status mudado à mão durante a falha não é sobrescrito na volta', async () => {
      const m = await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ failureThreshold: 1 }),
      );
      target.up = false;
      await tick();
      await h.prisma.component.update({
        where: { id: apiId },
        data: { status: 'under_maintenance' },
      });
      target.up = true;
      await tick();
      expect(await componentStatus()).toBe('under_maintenance');

      // Excluir o monitor com falha ativa normaliza o componente.
      target.up = false;
      await h.prisma.component.update({ where: { id: apiId }, data: { status: 'operational' } });
      await tick();
      expect(await componentStatus()).toBe('major_outage');
      expect((await owner.delete(`/api/pages/${pageId}/monitors/${m.body.id}`)).status).toBe(204);
      expect(await componentStatus()).toBe('operational');
      expect(await h.prisma.automationState.count()).toBe(0);
    });
  });

  describe('modo sugestão', () => {
    it('cria alerta; Operador aceita (aplica) e depois aceita a normalização', async () => {
      await createUser(h.prisma, { email: 'op@example.com', roles: { [pageId]: 'operator' } });
      const op = await loginAs(h, 'op@example.com');
      await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ failureThreshold: 1, mode: 'suggest' }),
      );
      target.up = false;
      await tick();
      expect(await componentStatus()).toBe('operational');
      const alerts = await op.get(`/api/pages/${pageId}/alerts`);
      expect(alerts.body).toHaveLength(1);
      expect(alerts.body[0]).toMatchObject({
        kind: 'failure',
        suggestedStatus: 'major_outage',
        component: { name: 'API' },
      });

      // Repetição atualiza o mesmo alerta.
      await h.prisma.monitor.updateMany({ data: { state: 'up', consecutiveFailures: 0 } });
      await tick();
      expect(await h.prisma.alert.count()).toBe(1);
      expect((await h.prisma.alert.findFirstOrThrow()).occurrences).toBe(2);

      const accept = await op.post(`/api/pages/${pageId}/alerts/${alerts.body[0].id}/accept`, {
        openIncident: false,
      });
      expect(accept.body).toEqual({ outcome: 'applied' });
      expect(await componentStatus()).toBe('major_outage');

      target.up = true;
      await tick();
      const recovery = await op.get(`/api/pages/${pageId}/alerts`);
      expect(recovery.body).toEqual([expect.objectContaining({ kind: 'recovery' })]);
      expect(await componentStatus()).toBe('major_outage');
      await op.post(`/api/pages/${pageId}/alerts/${recovery.body[0].id}/accept`, {});
      expect(await componentStatus()).toBe('operational');
    });

    it('sugestão some sozinha se o serviço volta antes; descartar não aplica', async () => {
      await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ failureThreshold: 1, mode: 'suggest' }),
      );
      target.up = false;
      await tick();
      target.up = true;
      await tick();
      expect((await owner.get(`/api/pages/${pageId}/alerts`)).body).toEqual([]);
      expect((await h.prisma.alert.findFirstOrThrow()).state).toBe('resolved');

      target.up = false;
      await tick();
      const [alert] = (await owner.get(`/api/pages/${pageId}/alerts`)).body;
      expect((await owner.post(`/api/pages/${pageId}/alerts/${alert.id}/dismiss`)).status).toBe(
        204,
      );
      expect(await componentStatus()).toBe('operational');
    });
  });

  describe('webhooks de entrada', () => {
    async function source(body: object) {
      const res = await owner.post(`/api/pages/${pageId}/inbound-sources`, body);
      expect(res.status).toBe(201);
      const path = new URL(res.body.url).pathname;
      return { id: res.body.id as string, path, url: res.body.url as string };
    }

    const alertmanager = (status: 'firing' | 'resolved') => ({
      version: '4',
      status,
      alerts: [
        {
          status,
          fingerprint: 'abc123',
          labels: { alertname: 'ApiDown', service: 'api', severity: 'critical' },
          annotations: { summary: 'API sem responder' },
        },
        {
          status,
          fingerprint: 'zzz',
          labels: { alertname: 'DiskFull', service: 'backup' },
          annotations: {},
        },
      ],
    });

    it('Alertmanager: regra por rótulo gera sugestão; normalização fecha', async () => {
      const src = await source({ name: 'Prometheus', kind: 'alertmanager' });
      expect(src.url).toMatch(/^https:\/\/status\.acme\.test\/api\/hooks\/in\//);
      const rules = await owner.put(`/api/pages/${pageId}/inbound-sources/${src.id}/rules`, {
        rules: [
          {
            matchField: 'label:service',
            pattern: 'api*',
            componentId: apiId,
            status: 'major_outage',
          },
        ],
      });
      expect(rules.body.rules).toHaveLength(1);

      const res = await h.anon.post(src.path, alertmanager('firing'));
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ received: 2, matched: 1, unmatched: 1 });
      const [alert] = (await owner.get(`/api/pages/${pageId}/alerts`)).body;
      expect(alert).toMatchObject({
        title: 'ApiDown',
        detail: 'API sem responder',
        source: 'inbound',
      });

      await h.anon.post(src.path, alertmanager('resolved'));
      expect((await owner.get(`/api/pages/${pageId}/alerts`)).body).toEqual([]);
      const stored = await h.prisma.inboundSource.findUniqueOrThrow({ where: { id: src.id } });
      expect(stored.lastResult).toMatchObject({ alerts: 2, unmatched: ['DiskFull'] });
    });

    it('token errado é 404; com HMAC, assinatura é obrigatória', async () => {
      const src = await source({ name: 'Genérico', kind: 'generic', hmacSecret: 'chave-hmac' });
      const wrong = src.path.replace(/[^/]+$/, 'x'.repeat(32));
      expect((await h.anon.post(wrong, { id: '1' })).status).toBe(404);

      const body = { id: 'job-1', name: 'backup', status: 'down', labels: {} };
      expect((await h.anon.post(src.path, body)).status).toBe(401);
      const raw = JSON.stringify(body);
      const sig = createHmac('sha256', 'chave-hmac').update(raw).digest('hex');
      const signed = await h.anon.agent
        .post(src.path)
        .set('Content-Type', 'application/json')
        .set('X-Signature', `sha256=${sig}`)
        .send(raw);
      expect(signed.status).toBe(202);
      expect(signed.body).toEqual({ received: 1, matched: 0, unmatched: 1 });
    });

    it('Uptime Kuma em modo automático muda o status e restaura', async () => {
      await subscriber('cliente@acme.test');
      const src = await source({ name: 'Kuma', kind: 'uptime_kuma', mode: 'auto' });
      await owner.put(`/api/pages/${pageId}/inbound-sources/${src.id}/rules`, {
        rules: [
          { matchField: 'name', pattern: 'API*', componentId: apiId, status: 'partial_outage' },
        ],
      });
      const kuma = (status: 0 | 1) => ({
        heartbeat: { status, msg: status ? 'OK' : 'timeout' },
        monitor: { id: 7, name: 'API produção', url: 'https://api.acme.test' },
        msg: 'x',
      });
      await h.anon.post(src.path, kuma(0));
      expect(await componentStatus()).toBe('partial_outage');
      expect(await runQueue()).toEqual(['component_status_changed']);
      expect(smtp.lastTo('cliente@acme.test')).toContain('API produ');
      await h.anon.post(src.path, kuma(1));
      expect(await componentStatus()).toBe('operational');

      // Mensagem de teste do Kuma (sem heartbeat) é aceita e ignorada.
      expect((await h.anon.post(src.path, { msg: 'test' })).body.received).toBe(0);

      // Origem desativada some (404).
      await owner.put(`/api/pages/${pageId}/inbound-sources/${src.id}`, {
        name: 'Kuma',
        mode: 'auto',
        enabled: false,
      });
      expect((await h.anon.post(src.path, kuma(0))).status).toBe(404);
    });

    it('regra só aceita componente da página e a URL só aparece para Admin', async () => {
      const src = await source({ name: 'Grafana', kind: 'grafana' });
      const other = (await owner.post('/api/pages', { slug: 'outra', name: 'Outra' })).body.id;
      const foreign = (await owner.post(`/api/pages/${other}/components`, { name: 'X' })).body.id;
      const res = await owner.put(`/api/pages/${pageId}/inbound-sources/${src.id}/rules`, {
        rules: [{ matchField: 'name', pattern: '*', componentId: foreign, status: 'major_outage' }],
      });
      expect(res.status).toBe(404);

      await createUser(h.prisma, { email: 'op@example.com', roles: { [pageId]: 'operator' } });
      const op = await loginAs(h, 'op@example.com');
      expect((await op.get(`/api/pages/${pageId}/inbound-sources`)).status).toBe(403);

      const rotated = await owner.post(
        `/api/pages/${pageId}/inbound-sources/${src.id}/rotate-token`,
      );
      expect(rotated.body.url).not.toBe(src.url);
      expect((await h.anon.post(src.path, { alerts: [] })).status).toBe(404);
    });
  });

  describe('métricas públicas', () => {
    it('só monitores marcados aparecem, com disponibilidade e latência', async () => {
      const pub = await owner.post(
        `/api/pages/${pageId}/monitors`,
        monitorBody({ publicMetrics: true }),
      );
      await owner.post(`/api/pages/${pageId}/monitors`, monitorBody({ name: 'Interno' }));
      const now = Date.now();
      await h.prisma.monitorCheckResult.createMany({
        data: [
          { monitorId: pub.body.id, checkedAt: new Date(now - 60_000), ok: true, latencyMs: 100 },
          { monitorId: pub.body.id, checkedAt: new Date(now - 120_000), ok: true, latencyMs: 200 },
          {
            monitorId: pub.body.id,
            checkedAt: new Date(now - 180_000),
            ok: false,
            latencyMs: null,
          },
          { monitorId: pub.body.id, checkedAt: new Date(now - 240_000), ok: true, latencyMs: 300 },
        ],
      });
      const res = await h.anon.get('/api/public/pages/acme/metrics?range=day');
      expect(res.status).toBe(200);
      expect(res.body.monitors).toHaveLength(1);
      const [m] = res.body.monitors;
      expect(m).toMatchObject({
        name: 'API pública',
        uptime: 75,
        avgLatencyMs: 200,
        checks: 4,
        component: { name: 'API' },
      });
      expect(m.points).toHaveLength(48);
      expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
      expect(
        (await h.anon.get('/api/public/pages/acme/metrics?range=month')).body.monitors[0].points,
      ).toHaveLength(60);
      expect((await h.anon.get('/api/public/pages/acme')).body.hasMetrics).toBe(true);
    });
  });

  describe('postmortem', () => {
    it('rascunho fica interno; publicado aparece sanitizado e avisa os assinantes', async () => {
      await subscriber('cliente@acme.test');
      const incident = await owner.post(`/api/pages/${pageId}/incidents`, {
        title: 'Queda do banco',
        impact: 'major',
        status: 'resolved',
        body: 'Resolvido.',
        notify: false,
        components: [{ componentId: apiId, status: 'operational' }],
      });
      const base = `/api/pages/${pageId}/incidents/${incident.body.id}/postmortem`;
      expect((await owner.get(base)).body).toEqual({ postmortem: null });
      expect((await owner.post(`${base}/publish`, {})).status).toBe(404);

      const saved = await owner.put(base, {
        body: '## Causa\n\nDisco cheio.<script>alert(1)</script>\n\n## Ações\n\n- Alertas de disco',
      });
      expect(saved.body.html).toContain('<h2>Causa</h2>');
      expect(saved.body.html).not.toContain('<script');

      const pub = `/api/public/pages/acme/incidents/${incident.body.id}`;
      expect((await h.anon.get(pub)).body.incident.postmortem).toBeNull();

      const published = await owner.post(`${base}/publish`, { notify: true });
      expect(published.body.publishedAt).toBeTruthy();
      const view = (await h.anon.get(pub)).body.incident.postmortem;
      expect(view.html).toContain('<li>Alertas de disco</li>');
      expect(await runQueue()).toEqual(['postmortem_published']);
      expect(smtp.lastTo('cliente@acme.test')).toContain('Postmortem');

      // Republicar não notifica de novo.
      await owner.post(`${base}/publish`, { notify: true });
      expect(await runQueue()).toEqual([]);
      await owner.post(`${base}/unpublish`);
      expect((await h.anon.get(pub)).body.incident.postmortem).toBeNull();
    });
  });
});
