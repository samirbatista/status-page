import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runDueMaintenanceTransitions } from '@status-page/core';
import {
  createHarness,
  createUser,
  loginAs,
  resetState,
  type Client,
  type Harness,
} from './support/harness.js';

describe('manutenções', () => {
  let h: Harness;
  let owner: Client;
  let pageId: string;
  let componentId: string;

  beforeAll(async () => {
    h = await createHarness();
  });

  beforeEach(async () => {
    await resetState(h.prisma, h.redis);
    await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
    owner = await loginAs(h, 'dono@example.com');
    pageId = (await owner.post('/api/pages', { slug: 'acme', name: 'Acme' })).body.id;
    componentId = (await owner.post(`/api/pages/${pageId}/components`, { name: 'API' })).body.id;
  });

  afterAll(() => h.close());

  const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

  it('janela já iniciada começa na hora e restaura o status ao concluir', async () => {
    await owner.put(`/api/pages/${pageId}/components/${componentId}/status`, {
      status: 'degraded_performance',
    });
    const res = await owner.post(`/api/pages/${pageId}/maintenances`, {
      title: 'Troca de servidor',
      body: 'Janela de manutenção.',
      scheduledStart: hours(-1),
      scheduledEnd: hours(1),
      componentIds: [componentId],
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('in_progress');

    let pub = await h.anon.get('/api/public/pages/acme');
    expect(pub.body.status).toBe('under_maintenance');
    expect(pub.body.maintenances[0].status).toBe('in_progress');

    const done = await owner.post(`/api/pages/${pageId}/maintenances/${res.body.id}/updates`, {
      status: 'completed',
      body: 'Concluída.',
    });
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('completed');

    pub = await h.anon.get('/api/public/pages/acme');
    // Volta ao status anterior à manutenção, não a "operacional".
    expect(pub.body.components[0].status).toBe('degraded_performance');
    expect(pub.body.maintenances).toHaveLength(0);
  });

  it('transições automáticas no horário agendado', async () => {
    const res = await owner.post(`/api/pages/${pageId}/maintenances`, {
      title: 'Atualização',
      body: 'Agendada.',
      scheduledStart: hours(1),
      scheduledEnd: hours(2),
      componentIds: [componentId],
    });
    expect(res.body.status).toBe('scheduled');

    const first = await runDueMaintenanceTransitions(h.prisma, hours(1.5));
    expect(first).toEqual({ started: [res.body.id], completed: [] });
    expect(
      (await h.prisma.component.findUniqueOrThrow({ where: { id: componentId } })).status,
    ).toBe('under_maintenance');

    const second = await runDueMaintenanceTransitions(h.prisma, hours(3));
    expect(second).toEqual({ started: [], completed: [res.body.id] });
    expect(
      (await h.prisma.component.findUniqueOrThrow({ where: { id: componentId } })).status,
    ).toBe('operational');

    const audit = await h.prisma.auditLog.findMany({
      where: { entityId: res.body.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'maintenance.create',
      'maintenance.start',
      'maintenance.complete',
    ]);
  });

  it('valida a janela e protege manutenções em andamento', async () => {
    const invalid = await owner.post(`/api/pages/${pageId}/maintenances`, {
      title: 'x',
      body: 'y',
      scheduledStart: hours(2),
      scheduledEnd: hours(1),
    });
    expect(invalid.status).toBe(400);

    const running = await owner.post(`/api/pages/${pageId}/maintenances`, {
      title: 'x',
      body: 'y',
      scheduledStart: hours(-1),
      scheduledEnd: hours(1),
    });
    expect(
      (await owner.delete(`/api/pages/${pageId}/maintenances/${running.body.id}`)).status,
    ).toBe(400);
  });
});
