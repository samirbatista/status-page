import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deliver,
  discordPayload,
  emailHtml,
  googleChatPayload,
  plainText,
  signWebhook,
  slackPayload,
  teamsPayload,
  telegramText,
} from './channels.js';
import { interpolate, renderMessage, unknownVariables, verificationTexts } from './render.js';
import { type EventPayload, NotifierError } from './types.js';
import { assertSubscriberWebhook } from './url-guard.js';

const payload: EventPayload = {
  type: 'incident_created',
  page: { id: 'p1', name: 'Acme', slug: 'acme', timezone: 'America/Sao_Paulo' },
  incident: {
    id: 'i1',
    title: 'Lentidão na API <script>',
    status: 'investigating',
    impact: 'major',
  },
  update: { body: 'Estamos investigando.' },
  components: [
    { id: 'c1', name: 'API', status: 'partial_outage' },
    { id: 'c2', name: 'Painel', status: 'degraded_performance' },
  ],
};
const links = {
  pageUrl: 'https://status.acme.com',
  itemUrl: 'https://status.acme.com/incidents/i1',
  manageUrl: 'https://status.acme.com/subscription/tok',
  unsubscribeUrl: 'https://status.acme.com/subscription/tok?unsubscribe=1',
};

describe('templates', () => {
  it('monta a mensagem padrão no idioma do destinatário', () => {
    const pt = renderMessage(payload, { locale: 'pt-BR', links });
    expect(pt.subject).toBe('[Acme] Incidente: Lentidão na API <script>');
    expect(pt.text).toContain('Estamos investigando.');
    expect(pt.text).toContain('Status: Investigando · Impacto alto');
    expect(pt.text).toContain('Componentes: API, Painel');
    const en = renderMessage(payload, { locale: 'en-US', links });
    expect(en.text).toContain('Status: Investigating · Major impact');
    expect(en.labels.unsubscribe).toBe('Unsubscribe');
  });

  it('usa o template personalizado e ignora variáveis desconhecidas', () => {
    const msg = renderMessage(payload, {
      locale: 'es',
      links,
      template: { subject: '{{ incident.title }}!', body: 'X {{nada}} {{component.name}}' },
    });
    expect(msg.subject).toBe('Lentidão na API <script>!');
    expect(msg.text).toBe('X  API');
    expect(unknownVariables('{{incident.title}} {{foo.bar}} {{ foo.bar }}')).toEqual(['foo.bar']);
    expect(interpolate('a {{b}} c', { b: 'B' })).toBe('a B c');
  });

  it('manutenção mostra a janela no fuso da página', () => {
    const msg = renderMessage(
      {
        ...payload,
        type: 'maintenance_scheduled',
        incident: undefined,
        maintenance: {
          id: 'm1',
          title: 'Troca de servidor',
          status: 'scheduled',
          scheduledStart: '2026-10-25T05:00:00Z',
          scheduledEnd: '2026-10-25T07:00:00Z',
        },
      },
      { locale: 'pt-BR', links },
    );
    expect(msg.text).toMatch(/25\/10\/2026.*02:00/);
  });

  it('códigos e convites', () => {
    const code = verificationTexts('code', 'pt-BR', { pageName: 'Acme', code: '123456' });
    expect(code.subject).toContain('123456');
    expect(code.text).toContain('15 minutos');
  });
});

describe('formatos dos canais', () => {
  const msg = renderMessage(payload, { locale: 'pt-BR', links });

  it('escapa HTML no e-mail e no Telegram', () => {
    expect(emailHtml(msg)).toContain('Lentidão na API &lt;script&gt;');
    expect(emailHtml(msg)).not.toContain('<script>');
    expect(telegramText(msg)).toContain('&lt;script&gt;');
  });

  it('toda mensagem a assinante leva os links de gerenciar e cancelar', () => {
    for (const text of [
      plainText(msg),
      emailHtml(msg),
      telegramText(msg),
      JSON.stringify(slackPayload(msg)),
      JSON.stringify(discordPayload(msg)),
      JSON.stringify(teamsPayload(msg)),
      JSON.stringify(googleChatPayload(msg)),
    ]) {
      expect(text).toContain(links.manageUrl);
      expect(text).toContain('unsubscribe=1');
    }
  });

  it('Teams usa Adaptive Card e Discord não menciona ninguém', () => {
    const teams = teamsPayload(msg);
    expect(teams.attachments[0]!.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(discordPayload(msg).allowed_mentions).toEqual({ parse: [] });
  });

  it('assinatura do webhook genérico', () => {
    const sig = signWebhook('segredo', '1700000000', '{"a":1}');
    const expected = createHmac('sha256', 'segredo').update('1700000000.{"a":1}').digest('hex');
    expect(sig).toBe(`sha256=${expected}`);
  });
});

describe('proteção contra SSRF em webhooks de assinantes', () => {
  const resolvePublic = async () => ['203.0.113.10'];

  it('aceita só HTTPS e domínios do serviço', async () => {
    await expect(
      assertSubscriberWebhook('slack', 'https://hooks.slack.com/services/T/B/x', {
        resolve: resolvePublic,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertSubscriberWebhook('teams', 'https://prod-01.westus.logic.azure.com/workflows/x', {
        resolve: resolvePublic,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertSubscriberWebhook('slack', 'http://hooks.slack.com/x', { resolve: resolvePublic }),
    ).rejects.toMatchObject({ message: 'https_required' });
    await expect(
      assertSubscriberWebhook('slack', 'https://evil.com/hooks.slack.com', {
        resolve: resolvePublic,
      }),
    ).rejects.toMatchObject({ message: 'host_not_allowed' });
    await expect(
      assertSubscriberWebhook('discord', 'https://hooks.slack.com/x', { resolve: resolvePublic }),
    ).rejects.toMatchObject({ message: 'host_not_allowed' });
  });

  it('recusa domínio permitido que resolve para IP privado', async () => {
    await expect(
      assertSubscriberWebhook('google_chat', 'https://chat.googleapis.com/v1/spaces/x', {
        resolve: async () => ['10.0.0.5'],
      }),
    ).rejects.toMatchObject({ message: 'private_address' });
    await expect(
      assertSubscriberWebhook('google_chat', 'https://chat.googleapis.com/v1/spaces/x', {
        resolve: async () => ['::ffff:127.0.0.1'],
      }),
    ).rejects.toMatchObject({ message: 'private_address' });
  });

  it('hosts extras liberam um laboratório', async () => {
    await expect(
      assertSubscriberWebhook('slack', 'http://localhost:9999/hook', { extraHosts: ['localhost'] }),
    ).resolves.toBeUndefined();
  });
});

describe('envio HTTP', () => {
  let server: Server;
  let base: string;
  const received: { url: string; headers: IncomingMessage['headers']; body: string }[] = [];
  let nextStatus = 200;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ url: req.url ?? '', headers: req.headers, body });
        res.writeHead(nextStatus, { 'Content-Type': 'application/json' });
        res.end(req.url?.includes('/bot') ? '{"ok":true,"result":{}}' : '{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const msg = renderMessage(payload, { locale: 'pt-BR', links });

  it('webhook genérico vai assinado', async () => {
    await deliver({ kind: 'webhook', url: `${base}/hook`, secret: 's3' }, msg, {}, { id: 'e1' });
    const req = received.at(-1)!;
    const sig = signWebhook('s3', String(req.headers['x-statuspage-timestamp']), req.body);
    expect(req.headers['x-statuspage-signature']).toBe(sig);
    expect(JSON.parse(req.body)).toMatchObject({ event: 'incident_created', data: { id: 'e1' } });
  });

  it('Telegram e WhatsApp usam as APIs configuradas', async () => {
    await deliver({ kind: 'telegram', chatId: '-100123' }, msg, {
      telegram: { botToken: '1:abc', apiUrl: base },
    });
    expect(received.at(-1)!.url).toBe('/bot1:abc/sendMessage');
    expect(JSON.parse(received.at(-1)!.body)).toMatchObject({
      chat_id: '-100123',
      parse_mode: 'HTML',
    });

    await deliver({ kind: 'whatsapp', phones: ['+5511999990000'] }, msg, {
      whatsapp: {
        phoneNumberId: '123',
        accessToken: 'tok',
        notificationTemplate: 'status_update',
        authTemplate: 'auth_code',
        templateLanguage: 'pt_BR',
        apiUrl: base,
      },
    });
    const wa = received.at(-1)!;
    expect(wa.url).toBe('/123/messages');
    expect(wa.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(wa.body)).toMatchObject({ to: '5511999990000', type: 'template' });
  });

  it('classifica erros: 4xx definitivo, 5xx e 429 repetíveis', async () => {
    nextStatus = 404;
    await expect(
      deliver({ kind: 'slack', webhookUrl: `${base}/x` }, msg, {}),
    ).rejects.toMatchObject({ retryable: false });
    nextStatus = 503;
    await expect(
      deliver({ kind: 'slack', webhookUrl: `${base}/x` }, msg, {}),
    ).rejects.toMatchObject({ retryable: true });
    nextStatus = 429;
    await expect(
      deliver({ kind: 'discord', webhookUrl: `${base}/x` }, msg, {}),
    ).rejects.toBeInstanceOf(NotifierError);
    nextStatus = 200;
  });

  it('sem SMTP configurado, falha sem repetir', async () => {
    await expect(
      deliver({ kind: 'email', recipients: ['a@b.com'] }, msg, {}),
    ).rejects.toMatchObject({
      message: 'smtp_not_configured',
      retryable: false,
    });
  });
});
