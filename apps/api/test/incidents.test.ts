import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localDate } from '@status-page/core';
import {
  createHarness,
  createUser,
  loginAs,
  resetState,
  type Client,
  type Harness,
} from './support/harness.js';

describe('fluxo de incidentes (critério de pronto da F1)', () => {
  let h: Harness;
  let owner: Client;
  let pageId: string;
  let apiId: string;
  let dbId: string;

  beforeAll(async () => {
    h = await createHarness();
  });

  beforeEach(async () => {
    await resetState(h.prisma, h.redis);
    await createUser(h.prisma, { email: 'dono@example.com', isOwner: true });
    owner = await loginAs(h, 'dono@example.com');

    const page = await owner.post('/api/pages', { slug: 'acme', name: 'Acme' });
    expect(page.status).toBe(201);
    pageId = page.body.id;
    const group = await owner.post(`/api/pages/${pageId}/groups`, { name: 'Plataforma' });
    apiId = (
      await owner.post(`/api/pages/${pageId}/components`, { name: 'API', groupId: group.body.id })
    ).body.id;
    dbId = (await owner.post(`/api/pages/${pageId}/components`, { name: 'Banco' })).body.id;
  });

  afterAll(() => h.close());

  it('operador abre, atualiza e resolve; a página pública e a auditoria acompanham', async () => {
    await createUser(h.prisma, { email: 'op@example.com', roles: { [pageId]: 'operator' } });
    const op = await loginAs(h, 'op@example.com');

    // Abre
    const created = await op.post(`/api/pages/${pageId}/incidents`, {
      title: 'Lentidão na API',
      impact: 'major',
      body: 'Investigando aumento de latência.',
      components: [{ componentId: apiId, status: 'partial_outage' }],
    });
    expect(created.status).toBe(201);
    const incidentId = created.body.id;

    let pub = await h.anon.get('/api/public/pages/acme');
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('partial_outage');
    expect(pub.body.activeIncidents).toHaveLength(1);
    expect(pub.body.activeIncidents[0]).toMatchObject({
      title: 'Lentidão na API',
      status: 'investigating',
    });
    expect(pub.body.components.find((c: { id: string }) => c.id === apiId).status).toBe(
      'partial_outage',
    );
    // Dados internos não vazam na API pública.
    expect(JSON.stringify(pub.body)).not.toMatch(/createdBy|notify|email/);

    // Atualiza
    const identified = await op.post(`/api/pages/${pageId}/incidents/${incidentId}/updates`, {
      status: 'identified',
      body: 'Causa identificada.',
      components: [{ componentId: apiId, status: 'major_outage' }],
    });
    expect(identified.status).toBe(201);
    pub = await h.anon.get('/api/public/pages/acme');
    expect(pub.body.status).toBe('major_outage');

    // Resolve sem citar o componente: ele volta a operacional sozinho.
    const resolved = await op.post(`/api/pages/${pageId}/incidents/${incidentId}/updates`, {
      status: 'resolved',
      body: 'Normalizado.',
    });
    expect(resolved.status).toBe(201);
    expect(resolved.body.resolvedAt).toBeTruthy();

    pub = await h.anon.get('/api/public/pages/acme');
    expect(pub.body.status).toBe('operational');
    expect(pub.body.activeIncidents).toHaveLength(0);
    expect(pub.body.pastIncidents).toHaveLength(1);
    expect(pub.body.pastIncidents[0].updates.map((u: { status: string }) => u.status)).toEqual([
      'resolved',
      'identified',
      'investigating',
    ]);

    const detail = await h.anon.get(`/api/public/pages/acme/incidents/${incidentId}`);
    expect(detail.status).toBe(200);

    // Auditoria
    const audit = await owner.get(`/api/audit?pageId=${pageId}&entityType=incident`);
    expect(audit.status).toBe(200);
    const actions = audit.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(['incident.update', 'incident.update', 'incident.create']);
    expect(audit.body.items[0].actor.email).toBe('op@example.com');

    // Histórico de status registrado para o uptime
    const history = await h.prisma.componentStatusHistory.findMany({
      where: { componentId: apiId },
      orderBy: { changedAt: 'asc' },
    });
    expect(history.map((x) => x.status)).toEqual([
      'operational',
      'partial_outage',
      'major_outage',
      'operational',
    ]);
  });

  it('não volta a operacional um componente afetado por outro incidente aberto', async () => {
    const a = await owner.post(`/api/pages/${pageId}/incidents`, {
      title: 'A',
      body: 'a',
      components: [{ componentId: dbId, status: 'major_outage' }],
    });
    await owner.post(`/api/pages/${pageId}/incidents`, {
      title: 'B',
      body: 'b',
      components: [{ componentId: dbId, status: 'major_outage' }],
    });
    await owner.post(`/api/pages/${pageId}/incidents/${a.body.id}/updates`, {
      status: 'resolved',
      body: 'ok',
    });
    const component = await h.prisma.component.findUniqueOrThrow({ where: { id: dbId } });
    expect(component.status).toBe('major_outage');
  });

  it('incidente retroativo entra no histórico sem mudar o status atual', async () => {
    // Meio-dia em São Paulo (15:00 UTC) de 3 dias atrás: as 2 h ficam dentro de um único dia.
    const now = new Date();
    const startedAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3, 15),
    );
    const resolvedAt = new Date(startedAt.getTime() + 2 * 3_600_000);
    const res = await owner.post(`/api/pages/${pageId}/incidents`, {
      title: 'Queda antiga',
      body: 'Registrado depois.',
      components: [{ componentId: apiId, status: 'major_outage' }],
      backfill: { startedAt, resolvedAt },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'resolved', backfilled: true });

    const component = await h.prisma.component.findUniqueOrThrow({ where: { id: apiId } });
    expect(component.status).toBe('operational');

    const pub = await h.anon.get('/api/public/pages/acme');
    const api = pub.body.components.find((c: { id: string }) => c.id === apiId);
    expect(api.uptime.days).toHaveLength(90);
    const affectedDay = api.uptime.days.find(
      (d: { majorOutageMinutes: number }) => d.majorOutageMinutes > 0,
    );
    expect(affectedDay.majorOutageMinutes).toBe(120);
    expect(api.uptime.uptime).toBeLessThan(1);
  });

  it('respeita os papéis e não permite acessar incidentes de outra página', async () => {
    await createUser(h.prisma, { email: 'leitor@example.com', roles: { [pageId]: 'viewer' } });
    const viewer = await loginAs(h, 'leitor@example.com');
    expect((await viewer.get(`/api/pages/${pageId}/incidents`)).status).toBe(200);
    const denied = await viewer.post(`/api/pages/${pageId}/incidents`, { title: 'x', body: 'y' });
    expect(denied.status).toBe(403);

    // Admin da página B tentando usar um incidente da página A pela rota da B.
    const other = await owner.post('/api/pages', { slug: 'outra', name: 'Outra' });
    await createUser(h.prisma, {
      email: 'adminb@example.com',
      roles: { [other.body.id]: 'admin' },
    });
    const adminB = await loginAs(h, 'adminb@example.com');
    const incident = await owner.post(`/api/pages/${pageId}/incidents`, { title: 'A', body: 'a' });
    expect((await adminB.get(`/api/pages/${pageId}/incidents/${incident.body.id}`)).status).toBe(
      403,
    );
    expect(
      (await adminB.get(`/api/pages/${other.body.id}/incidents/${incident.body.id}`)).status,
    ).toBe(404);
    // Componentes de outra página também são recusados.
    const cross = await adminB.post(`/api/pages/${other.body.id}/incidents`, {
      title: 'x',
      body: 'y',
      components: [{ componentId: apiId, status: 'major_outage' }],
    });
    expect(cross.status).toBe(404);
  });

  it('páginas privadas exigem login na API pública', async () => {
    await owner.patch(`/api/pages/${pageId}`, { visibility: 'private' });
    const res = await h.anon.get('/api/public/pages/acme');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('login_required');
    expect((await owner.get('/api/public/pages/acme')).status).toBe(200);
  });

  it('a primeira página criada é a padrão', async () => {
    const res = await h.anon.get('/api/public/default');
    expect(res.body).toEqual({ slug: 'acme' });
  });

  it('histórico mensal lista os incidentes do mês', async () => {
    await owner.post(`/api/pages/${pageId}/incidents`, { title: 'Agora', body: 'x' });
    // Mês no fuso da página (padrão America/Sao_Paulo), não em UTC.
    const month = localDate(new Date(), 'America/Sao_Paulo').slice(0, 7);
    const res = await h.anon.get(`/api/public/pages/acme/history?month=${month}`);
    expect(res.status).toBe(200);
    expect(res.body.incidents.map((i: { title: string }) => i.title)).toContain('Agora');
    expect((await h.anon.get('/api/public/pages/acme/history?month=2026-13')).status).toBe(400);
  });

  it('templates de incidente: CRUD e nome único', async () => {
    const body = {
      name: 'Lentidão',
      title: 'Lentidão',
      body: 'Investigando.',
      componentIds: [apiId],
    };
    expect((await owner.post(`/api/pages/${pageId}/templates`, body)).status).toBe(201);
    expect((await owner.post(`/api/pages/${pageId}/templates`, body)).status).toBe(409);
    const list = await owner.get(`/api/pages/${pageId}/templates`);
    expect(list.body).toHaveLength(1);
  });

  it('layout reordena grupos e componentes', async () => {
    const structure = await owner.get(`/api/pages/${pageId}/structure`);
    const groupId = structure.body.groups[0].id;
    const res = await owner.put(`/api/pages/${pageId}/layout`, {
      groups: [groupId],
      components: [
        { componentId: dbId, groupId },
        { componentId: apiId, groupId: null },
      ],
    });
    expect(res.status).toBe(204);
    const after = await owner.get(`/api/pages/${pageId}/structure`);
    expect(after.body.components.map((c: { id: string }) => c.id)).toEqual([dbId, apiId]);

    const mismatch = await owner.put(`/api/pages/${pageId}/layout`, { groups: [], components: [] });
    expect(mismatch.status).toBe(400);
  });
});
