import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SecretBox } from '@status-page/core';
import {
  cleanupSubscribers,
  handleTelegramUpdate,
  maintenanceReminders,
  sweepPendingEvents,
} from '@status-page/notifiers';
import { FakeHttp } from './support/fakes.js';
import {
  type Client,
  createHarness,
  createUser,
  loginAs,
  resetState,
  type Harness,
} from './support/harness.js';
import { testEnv } from './support/env.js';

/** Rotinas do worker contra o banco real. */
describe('F4: rotinas do worker', () => {
  const http = new FakeHttp();
  let h: Harness;
  let owner: Client;
  let pageId: string;
  const secrets = new SecretBox(testEnv().APP_SECRET);

  beforeAll(async () => {
    await http.start();
    h = await createHarness({ TELEGRAM_API_URL: http.base });
  });

  beforeEach(async () => {
    await resetState(h.prisma, h.redis);
    await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
    owner = await loginAs(h, 'dono@example.com');
    pageId = (await owner.post('/api/pages', { slug: 'acme', name: 'Acme' })).body.id;
    await owner.put('/api/notifications/settings/telegram', {
      enabled: true,
      botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWX',
    });
  });

  afterAll(async () => {
    await h.close();
    await http.stop();
  });

  it('/start <token> ativa a inscrição do Telegram e /stop cancela', async () => {
    const res = await h.anon.post('/api/public/pages/acme/subscriptions', {
      kind: 'telegram',
      locale: 'pt-BR',
      consent: true,
    });
    const token = res.body.pendingToken as string;
    const message = (text: string) => ({
      update_id: 1,
      message: { chat: { id: 987654, type: 'private' }, text },
    });

    expect(
      await handleTelegramUpdate(h.prisma, secrets, message('/start invalido-123456789')),
    ).toMatch(/inválido/);
    expect(await handleTelegramUpdate(h.prisma, secrets, message(`/start ${token}`))).toContain(
      'Acme',
    );
    const status = await h.anon.get(`/api/public/subscriptions/pending/${token}`);
    expect(status.body.status).toBe('active');
    expect(status.body.manageToken).toBeDefined();
    // O mesmo link não vincula outro chat.
    expect(await handleTelegramUpdate(h.prisma, secrets, message(`/start ${token}`))).toMatch(
      /inválido/,
    );

    await handleTelegramUpdate(h.prisma, secrets, message('/stop'));
    const sub = await h.prisma.subscriber.findFirstOrThrow();
    expect(sub.status).toBe('unsubscribed');
  });

  it('remove inscrições não confirmadas depois de 24 h', async () => {
    await h.prisma.subscriber.createMany({
      data: [
        {
          pageId,
          kind: 'email',
          status: 'pending',
          manageTokenEnc: 'x',
          manageTokenHash: 'a',
          createdAt: new Date(Date.now() - 25 * 3_600_000),
        },
        {
          pageId,
          kind: 'email',
          status: 'pending',
          manageTokenEnc: 'x',
          manageTokenHash: 'b',
        },
        {
          pageId,
          kind: 'email',
          status: 'active',
          manageTokenEnc: 'x',
          manageTokenHash: 'c',
          createdAt: new Date(Date.now() - 48 * 3_600_000),
        },
      ],
    });
    expect(await cleanupSubscribers(h.prisma)).toBe(1);
    expect(await h.prisma.subscriber.count()).toBe(2);
  });

  it('lembra a manutenção 24 h antes, uma única vez', async () => {
    const start = new Date(Date.now() + 20 * 3_600_000);
    const maint = await h.prisma.maintenance.create({
      data: {
        pageId,
        title: 'Troca de servidor',
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + 3_600_000),
        createdAt: new Date(Date.now() - 3 * 24 * 3_600_000),
      },
    });
    expect(await maintenanceReminders(h.prisma)).toEqual([maint.id]);
    expect(await maintenanceReminders(h.prisma)).toEqual([]);
    const events = await h.prisma.notificationEvent.findMany();
    expect(events.map((e) => e.type)).toEqual(['maintenance_reminder']);

    const queued: string[] = [];
    const queue = {
      add: async (_: string, data: unknown) => void queued.push(JSON.stringify(data)),
    };
    expect(await sweepPendingEvents(h.prisma, queue, new Date(Date.now() + 60_000))).toBe(1);
    expect(queued[0]).toContain(events[0]!.id);
  });

  it('início automático da manutenção gera o evento de início', async () => {
    const res = await owner.post(`/api/pages/${pageId}/maintenances`, {
      title: 'Janela agora',
      body: 'Começando',
      scheduledStart: new Date(Date.now() - 60_000).toISOString(),
      scheduledEnd: new Date(Date.now() + 3_600_000).toISOString(),
      componentIds: [],
      notify: true,
    });
    expect(res.status).toBe(201);
    const types = (
      await h.prisma.notificationEvent.findMany({ orderBy: { createdAt: 'asc' } })
    ).map((e) => e.type);
    expect(types).toEqual(['maintenance_scheduled', 'maintenance_started']);
  });
});
