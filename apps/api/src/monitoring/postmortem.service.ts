import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type AuditContext,
  recordAudit,
  recordPostmortemEvent,
  renderMarkdown,
} from '@status-page/core';
import { NotifyService } from '../infra/notify.service.js';
import { PrismaService } from '../infra/prisma.service.js';

/** Postmortem do incidente: rascunho em Markdown, publicado na página pública. */
@Injectable()
export class PostmortemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  async get(pageId: string, incidentId: string) {
    await this.findIncident(pageId, incidentId);
    const postmortem = await this.prisma.client.postmortem.findUnique({ where: { incidentId } });
    return postmortem ? { ...postmortem, html: renderMarkdown(postmortem.body) } : null;
  }

  async save(pageId: string, incidentId: string, body: string, audit: AuditContext) {
    await this.findIncident(pageId, incidentId);
    const postmortem = await this.prisma.client.$transaction(async (tx) => {
      const saved = await tx.postmortem.upsert({
        where: { incidentId },
        create: { incidentId, body, updatedById: audit.actorId ?? null },
        update: { body, updatedById: audit.actorId ?? null },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'postmortem.save',
        entityType: 'incident',
        entityId: incidentId,
        pageId,
        after: { length: body.length, published: Boolean(saved.publishedAt) },
      });
      return saved;
    });
    return { ...postmortem, html: renderMarkdown(postmortem.body) };
  }

  async publish(pageId: string, incidentId: string, notify: boolean, audit: AuditContext) {
    await this.findIncident(pageId, incidentId);
    const postmortem = await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.postmortem.findUnique({ where: { incidentId } });
      if (!current?.body.trim()) throw new NotFoundException({ message: 'postmortem_empty' });
      const saved = await tx.postmortem.update({
        where: { incidentId },
        data: {
          publishedAt: current.publishedAt ?? new Date(),
          updatedById: audit.actorId ?? null,
        },
      });
      // Só a primeira publicação avisa os assinantes.
      if (notify && !current.publishedAt) await recordPostmortemEvent(tx, incidentId);
      await recordAudit(tx, {
        ...audit,
        action: 'postmortem.publish',
        entityType: 'incident',
        entityId: incidentId,
        pageId,
        after: { notify },
      });
      return saved;
    });
    await this.notify.flush();
    return { ...postmortem, html: renderMarkdown(postmortem.body) };
  }

  async unpublish(pageId: string, incidentId: string, audit: AuditContext) {
    await this.findIncident(pageId, incidentId);
    const postmortem = await this.prisma.client.$transaction(async (tx) => {
      const saved = await tx.postmortem.update({
        where: { incidentId },
        data: { publishedAt: null },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'postmortem.unpublish',
        entityType: 'incident',
        entityId: incidentId,
        pageId,
      });
      return saved;
    });
    return { ...postmortem, html: renderMarkdown(postmortem.body) };
  }

  private async findIncident(pageId: string, incidentId: string) {
    const incident = await this.prisma.client.incident.findFirst({
      where: { id: incidentId, pageId },
      select: { id: true },
    });
    if (!incident) throw new NotFoundException({ message: 'incident_not_found' });
  }
}
