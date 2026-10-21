import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fanOutEvent, processDelivery } from '@status-page/notifiers';
import { NotifyService } from '../src/infra/notify.service.js';
import { FakeHttp, FakeSmtp } from './support/fakes.js';
import {
  type Client,
  createHarness,
  createUser,
  loginAs,
  resetState,
  type Harness,
} from './support/harness.js';

const http = new FakeHttp();
const smtp = new FakeSmtp();

/** Código de 6 dígitos do último e-mail enviado ao endereço. */
function codeFor(email: string): string {
  const mail = smtp.lastTo(email);
  const code = mail && /(\d{6}) para confirmar/.exec(mail)?.[1];
  if (!code) throw new Error(`sem código para ${email}`);
  return code;
}

describe('F4: notificações e assinantes', () => {
  let h: Harness;
  let owner: Client;
  let pageId: string;
  let apiId: string;
  let dbId: string;

  /** Distribui e entrega todos os eventos pendentes (o que o worker faz). */
  async function runQueue() {
    const ctx = h.app.get(NotifyService).context;
    const events = await h.prisma.notificationEvent.findMany({ where: { fannedOutAt: null } });
    const outcomes = [];
    for (const event of events) {
      for (const id of await fanOutEvent(h.prisma, event.id)) {
        outcomes.push(await processDelivery(ctx, id));
      }
    }
    return outcomes;
  }

  async function subscribeEmail(email: string, extra: object = {}) {
    const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
      kind: 'email',
      target: email,
      locale: 'pt-BR',
      consent: true,
      ...extra,
    });
    expect(res.status).toBe(200);
    return res.body as { next: string; pendingToken: string; target: string };
  }

  async function confirmEmail(email: string, extra: object = {}) {
    const { pendingToken } = await subscribeEmail(email, extra);
    const res = await h.anon.post(`/api/public/subscriptions/pending/${pendingToken}/confirm`, {
      code: codeFor(email),
    });
    expect(res.status).toBe(200);
    return res.body.manageToken as string;
  }

  async function openIncident(componentId: string, notify = true) {
    const res = await owner.post(`/api/pages/${pageId}/incidents`, {
      title: 'Lentidão na API',
      impact: 'major',
      status: 'investigating',
      body: 'Estamos investigando.',
      notify,
      components: [{ componentId, status: 'partial_outage' }],
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    await http.start();
    await smtp.start();
    h = await createHarness({
      PUBLIC_URL: 'https://status.acme.test',
      TELEGRAM_API_URL: http.base,
      WHATSAPP_API_URL: `${http.base}/wa`,
      WEBHOOK_EXTRA_HOSTS: 'localhost',
    });
  });

  beforeEach(async () => {
    await resetState(h.prisma, h.redis);
    http.requests.length = 0;
    http.statusFor.clear();
    smtp.messages.length = 0;
    await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
    owner = await loginAs(h, 'dono@example.com');
    pageId = (await owner.post('/api/pages', { slug: 'acme', name: 'Acme' })).body.id;
    apiId = (await owner.post(`/api/pages/${pageId}/components`, { name: 'API' })).body.id;
    dbId = (await owner.post(`/api/pages/${pageId}/components`, { name: 'Banco' })).body.id;
    expect(
      (
        await owner.put('/api/notifications/settings/smtp', {
          enabled: true,
          host: '127.0.0.1',
          port: smtp.port,
          security: 'none',
          username: '',
          from: 'Status <status@acme.test>',
        })
      ).status,
    ).toBe(200);
  });

  afterAll(async () => {
    await h.close();
    await http.stop();
    await smtp.stop();
  });

  describe('provedores globais', () => {
    it('só o Dono configura e os segredos não voltam', async () => {
      const tg = await owner.put('/api/notifications/settings/telegram', {
        enabled: true,
        botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWX',
      });
      expect(tg.status).toBe(200);
      expect(tg.body.telegram).toEqual({
        enabled: true,
        botUsername: 'status_test_bot',
        hasToken: true,
      });
      const stored = await h.prisma.setting.findUniqueOrThrow({
        where: { key: 'notify.telegram' },
      });
      expect(JSON.stringify(stored.value)).not.toContain('ABCDEFGH');

      await createUser(h.prisma, { email: 'admin@example.com', roles: { [pageId]: 'admin' } });
      const admin = await loginAs(h, 'admin@example.com');
      expect((await admin.get('/api/notifications/settings')).status).toBe(403);
    });

    it('teste de SMTP envia um e-mail', async () => {
      const res = await owner.post('/api/notifications/settings/smtp/test', { to: 'ti@acme.test' });
      expect(res.body).toEqual({ ok: true });
      expect(smtp.lastTo('ti@acme.test')).toContain('SMTP');
    });
  });

  describe('inscrição por e-mail com código', () => {
    it('sem confirmar o código, nada é enviado; confirmado, recebe', async () => {
      await subscribeEmail('pendente@cliente.test');
      await confirmEmail('ativo@cliente.test');
      smtp.messages.length = 0;

      await openIncident(apiId);
      const outcomes = await runQueue();
      expect(outcomes).toEqual([{ status: 'sent' }]);
      expect(smtp.lastTo('pendente@cliente.test')).toBeUndefined();
      const mail = smtp.lastTo('ativo@cliente.test')!;
      expect(mail).toContain('Lentid');
      // Toda mensagem leva o link de gerenciamento e de cancelamento.
      expect(mail).toMatch(/https:\/\/status\.acme\.test\/p\/acme\/subscription\/[\w-]{40,}/);
      expect(mail).toContain('action=unsubscribe');
    });

    it('código guardado só como hash; 5 tentativas; reenvio após 60 s', async () => {
      const { pendingToken } = await subscribeEmail('ana@cliente.test');
      const code = codeFor('ana@cliente.test');
      const stored = await h.prisma.verificationCode.findFirstOrThrow();
      expect(stored.codeHash).not.toContain(code);

      const resend = await h.anon.post(`/api/public/subscriptions/pending/${pendingToken}/resend`);
      expect(resend.status).toBe(429);

      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 1; i <= 4; i++) {
        const res = await h.anon.post(`/api/public/subscriptions/pending/${pendingToken}/confirm`, {
          code: wrong,
        });
        expect(res.body).toMatchObject({ message: 'invalid_code', attemptsLeft: 5 - i });
      }
      const fifth = await h.anon.post(`/api/public/subscriptions/pending/${pendingToken}/confirm`, {
        code: wrong,
      });
      expect(fifth.body.message).toBe('code_attempts_exceeded');
      const right = await h.anon.post(`/api/public/subscriptions/pending/${pendingToken}/confirm`, {
        code,
      });
      expect(right.body.message).toBe('code_attempts_exceeded');
    });

    it('código expirado não confirma', async () => {
      const { pendingToken } = await subscribeEmail('ana@cliente.test');
      await h.prisma.verificationCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
      const res = await h.anon.post(`/api/public/subscriptions/pending/${pendingToken}/confirm`, {
        code: codeFor('ana@cliente.test'),
      });
      expect(res.body.message).toBe('code_expired');
    });

    it('registra o consentimento (LGPD)', async () => {
      await confirmEmail('ana@cliente.test');
      const consents = await h.prisma.consentRecord.findMany({ orderBy: { createdAt: 'asc' } });
      expect(consents.map((c) => c.action)).toEqual(['subscribe', 'confirm']);
      expect(consents[0]!.text).toMatch(/^subscribe:v1:pt-BR$/);
    });

    it('assinante só dos componentes escolhidos não recebe o resto', async () => {
      await confirmEmail('banco@cliente.test', { allComponents: false, componentIds: [dbId] });
      await confirmEmail('api@cliente.test', { allComponents: false, componentIds: [apiId] });
      await confirmEmail('manut@cliente.test', { events: ['maintenance'] });
      smtp.messages.length = 0;
      await openIncident(apiId);
      await runQueue();
      expect(smtp.lastTo('api@cliente.test')).toBeDefined();
      expect(smtp.lastTo('banco@cliente.test')).toBeUndefined();
      expect(smtp.lastTo('manut@cliente.test')).toBeUndefined();
    });

    it('atualização sem "notificar" e incidente retroativo não geram evento', async () => {
      await confirmEmail('ana@cliente.test');
      await openIncident(apiId, false);
      expect(await h.prisma.notificationEvent.count()).toBe(0);
    });
  });

  describe('gerenciamento pelo assinante', () => {
    it('muda preferências, cancela e exclui os dados', async () => {
      const token = await confirmEmail('ana@cliente.test');
      const get = await h.anon.get(`/api/public/subscriptions/${token}`);
      expect(get.body).toMatchObject({
        kind: 'email',
        target: 'an***@cliente.test',
        status: 'active',
      });

      const update = await h.anon.put(`/api/public/subscriptions/${token}`, {
        locale: 'en-US',
        allComponents: false,
        componentIds: [apiId],
        events: ['incident'],
      });
      expect(update.body).toMatchObject({ locale: 'en-US', componentIds: [apiId] });

      smtp.messages.length = 0;
      await openIncident(apiId);
      await runQueue();
      expect(smtp.lastTo('ana@cliente.test')).toContain('Manage subscription');

      await h.anon.post(`/api/public/subscriptions/${token}/unsubscribe`);
      smtp.messages.length = 0;
      await openIncident(apiId);
      await runQueue();
      expect(smtp.lastTo('ana@cliente.test')).toBeUndefined();

      expect((await h.anon.delete(`/api/public/subscriptions/${token}`)).status).toBe(204);
      expect(await h.prisma.subscriber.count()).toBe(0);
      const consents = await h.prisma.consentRecord.findMany();
      expect(consents.map((c) => c.action)).toContain('delete');
      expect(JSON.stringify(consents)).not.toContain('ana@cliente.test');
    });
  });

  describe('canais da equipe', () => {
    it('um incidente chega a todos os canais configurados', async () => {
      await owner.put('/api/notifications/settings/telegram', {
        enabled: true,
        botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWX',
      });
      await owner.put('/api/notifications/settings/whatsapp', {
        enabled: true,
        phoneNumberId: '1234567',
        accessToken: 'wa-token',
        notificationTemplate: 'status_update',
        authTemplate: 'status_code',
        templateLanguage: 'pt_BR',
      });
      const channels = [
        { kind: 'email', config: { recipients: ['noc@acme.test'] } },
        { kind: 'telegram', config: { chatId: '-1001234' } },
        { kind: 'slack', config: { webhookUrl: `${http.base}/slack` } },
        { kind: 'discord', config: { webhookUrl: `${http.base}/discord` } },
        { kind: 'teams', config: { webhookUrl: `${http.base}/teams` } },
        { kind: 'google_chat', config: { webhookUrl: `${http.base}/gchat` } },
        { kind: 'whatsapp', config: { phones: ['+55 11 99999-0000'] } },
        { kind: 'webhook', config: { url: `${http.base}/generic`, secret: 'segredo-hmac' } },
      ];
      for (const c of channels) {
        const res = await owner.post(`/api/pages/${pageId}/notification-channels`, {
          ...c,
          name: `Canal ${c.kind}`,
        });
        expect(res.status, c.kind).toBe(201);
      }
      // Segredos mascarados na listagem.
      const list = await owner.get(`/api/pages/${pageId}/notification-channels`);
      expect(JSON.stringify(list.body)).not.toContain('segredo-hmac');
      expect(JSON.stringify(list.body)).not.toContain('/slack');

      await openIncident(apiId);
      const outcomes = await runQueue();
      expect(outcomes).toHaveLength(8);
      expect(outcomes.every((o) => o.status === 'sent')).toBe(true);

      expect(smtp.lastTo('noc@acme.test')).toContain('Lentid');
      expect(http.to('/bot123456:')).toHaveLength(2); // getMe + sendMessage
      expect(JSON.parse(http.to('/slack')[0]!.body).text).toContain('Lentidão na API');
      expect(JSON.parse(http.to('/discord')[0]!.body).embeds[0].title).toBe('Lentidão na API');
      expect(http.to('/teams')[0]!.body).toContain('AdaptiveCard');
      expect(http.to('/gchat')[0]!.body).toContain('cardsV2');
      const wa = http.to('/wa/1234567/messages')[0]!;
      expect(JSON.parse(wa.body)).toMatchObject({ to: '5511999990000', type: 'template' });
      const generic = http.to('/generic')[0]!;
      expect(generic.headers['x-statuspage-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

      const deliveries = await owner.get(`/api/pages/${pageId}/notification-deliveries`);
      expect(deliveries.body.items).toHaveLength(8);
      expect(deliveries.body.items.every((d: { status: string }) => d.status === 'sent')).toBe(
        true,
      );
    });

    it('falha temporária fica pendente; na última tentativa vira falha; reenvio reabre', async () => {
      http.statusFor.set('/flaky', 503);
      await owner.post(`/api/pages/${pageId}/notification-channels`, {
        kind: 'slack',
        name: 'Instável',
        config: { webhookUrl: `${http.base}/flaky` },
      });
      await openIncident(apiId);
      const ctx = h.app.get(NotifyService).context;
      const event = await h.prisma.notificationEvent.findFirstOrThrow();
      const [id] = await fanOutEvent(h.prisma, event.id);
      expect(await processDelivery(ctx, id!)).toMatchObject({ status: 'retry' });
      expect(await processDelivery(ctx, id!, { finalAttempt: true })).toMatchObject({
        status: 'failed',
      });
      const row = await h.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: 'failed', attempts: 2 });
      expect(row.lastError).toContain('503');

      const resend = await owner.post(`/api/pages/${pageId}/notification-deliveries/${id}/resend`);
      expect(resend.status).toBe(204);
      expect(
        (await h.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).status,
      ).toBe('pending');
    });

    it('"Enviar teste" registra o resultado', async () => {
      http.statusFor.set('/broken', 404);
      const ok = await owner.post(`/api/pages/${pageId}/notification-channels`, {
        kind: 'discord',
        name: 'Ok',
        config: { webhookUrl: `${http.base}/discord-ok` },
      });
      const bad = await owner.post(`/api/pages/${pageId}/notification-channels`, {
        kind: 'discord',
        name: 'Quebrado',
        config: { webhookUrl: `${http.base}/broken` },
      });
      expect(
        (await owner.post(`/api/pages/${pageId}/notification-channels/${ok.body.id}/test`)).body,
      ).toEqual({ ok: true });
      const res = await owner.post(
        `/api/pages/${pageId}/notification-channels/${bad.body.id}/test`,
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('404');
    });

    it('template personalizado vale para o canal e o idioma', async () => {
      await owner.post(`/api/pages/${pageId}/notification-channels`, {
        kind: 'email',
        name: 'NOC',
        config: { recipients: ['noc@acme.test'] },
      });
      const bad = await owner.put(`/api/pages/${pageId}/notification-templates`, {
        channel: 'email',
        event: 'incident_created',
        locale: 'pt-BR',
        subject: '{{inexistente}}',
        body: 'x',
      });
      expect(bad.body).toMatchObject({ message: 'unknown_variables', variables: ['inexistente'] });
      await owner.put(`/api/pages/${pageId}/notification-templates`, {
        channel: 'email',
        event: 'incident_created',
        locale: 'pt-BR',
        subject: 'ALERTA {{incident.title}}',
        body: 'Afeta: {{components}}',
      });
      await openIncident(apiId);
      await runQueue();
      const mail = smtp.lastTo('noc@acme.test')!;
      expect(mail).toContain('ALERTA');
      expect(mail).toContain('Afeta: API');
    });
  });

  describe('webhooks de assinantes (SSRF)', () => {
    it('aceita após a mensagem de teste chegar', async () => {
      const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
        kind: 'slack',
        target: `${http.localhostBase}/sub-slack`,
        locale: 'pt-BR',
        consent: true,
      });
      expect(res.body).toMatchObject({ next: 'active' });
      expect(http.to('/sub-slack')).toHaveLength(1);
      await openIncident(apiId);
      expect(await runQueue()).toEqual([{ status: 'sent' }]);
      expect(http.to('/sub-slack')[1]!.body).toContain('subscription');
    });

    it('recusa domínio fora da lista e endereço interno', async () => {
      for (const target of [
        `${http.base}/x`,
        'https://evil.example.com/hooks',
        'https://hooks.slack.com.evil.test/x',
      ]) {
        const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
          kind: 'slack',
          target,
          locale: 'pt-BR',
          consent: true,
        });
        expect(res.body.message, target).toBe('invalid_webhook');
      }
    });

    it('exige consentimento', async () => {
      const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
        kind: 'email',
        target: 'ana@cliente.test',
        locale: 'pt-BR',
        consent: false,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Telegram e WhatsApp', () => {
    it('Telegram devolve o link do bot; a inscrição fica pendente até o /start', async () => {
      await owner.put('/api/notifications/settings/telegram', {
        enabled: true,
        botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWX',
      });
      const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
        kind: 'telegram',
        locale: 'pt-BR',
        consent: true,
      });
      expect(res.body.link).toMatch(/^https:\/\/t\.me\/status_test_bot\?start=[\w-]{40,}$/);
      const status = await h.anon.get(`/api/public/subscriptions/pending/${res.body.pendingToken}`);
      expect(status.body).toEqual({ status: 'pending' });
    });

    it('WhatsApp envia o código pelo template de autenticação', async () => {
      await owner.put('/api/notifications/settings/whatsapp', {
        enabled: true,
        phoneNumberId: '1234567',
        accessToken: 'wa-token',
        notificationTemplate: 'status_update',
        authTemplate: 'status_code',
        templateLanguage: 'pt_BR',
      });
      const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
        kind: 'whatsapp',
        target: '+55 (11) 98888-7777',
        locale: 'pt-BR',
        consent: true,
      });
      expect(res.body).toMatchObject({ next: 'code', target: '+55******7777' });
      const sent = JSON.parse(http.to('/wa/1234567/messages')[0]!.body);
      expect(sent.template.name).toBe('status_code');
      const code = sent.template.components[0].parameters[0].text as string;
      const confirm = await h.anon.post(
        `/api/public/subscriptions/pending/${res.body.pendingToken}/confirm`,
        { code },
      );
      expect(confirm.body.manageToken).toBeDefined();
    });

    it('canal indisponível sem o provedor configurado', async () => {
      const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
        kind: 'telegram',
        locale: 'pt-BR',
        consent: true,
      });
      expect(res.body.message).toBe('channel_unavailable');
    });
  });

  describe('assinantes no painel', () => {
    it('importa com convite (sem confirmar, nada chega) e exporta CSV', async () => {
      const imported = await owner.post(`/api/pages/${pageId}/subscribers/import`, {
        csv: 'email,locale,components\nnovo@cliente.test,es,API\ninvalido,pt-BR,\n',
      });
      expect(imported.body).toEqual({ invited: 1, skipped: 0, invalid: [3] });
      const invite = smtp.lastTo('novo@cliente.test')!;
      const token = /subscription\/invite\/([\w-]+)/.exec(invite)?.[1];
      expect(token).toBeDefined();

      await openIncident(apiId);
      expect(await runQueue()).toEqual([]);

      const accepted = await h.anon.post(`/api/public/subscriptions/invite/${token}`);
      expect(accepted.body.manageToken).toBeDefined();
      await openIncident(apiId);
      expect(await runQueue()).toEqual([{ status: 'sent' }]);
      expect(smtp.lastTo('novo@cliente.test')).toContain('Gestionar');

      const csv = await owner.get(`/api/pages/${pageId}/subscribers/export.csv`);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('email,novo@cliente.test,es,active');
      const list = await owner.get(`/api/pages/${pageId}/subscribers`);
      expect(list.body.items[0]).toMatchObject({
        targetDisplay: 'no***@cliente.test',
        source: 'import',
      });
      expect(JSON.stringify(list.body)).not.toContain('novo@cliente.test');
    });

    it('página privada: só quem pode ver assina', async () => {
      await owner.patch(`/api/pages/${pageId}`, { visibility: 'private', privateAccess: 'login' });
      const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
        kind: 'email',
        target: 'ana@cliente.test',
        locale: 'pt-BR',
        consent: true,
      });
      expect(res.status).toBe(401);
    });
  });
});
