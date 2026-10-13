import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type AuditContext, recordAudit } from '@status-page/core';
import { Prisma } from '@status-page/db';
import { type incidentTemplateSchema } from '@status-page/shared';
import { type z } from 'zod';
import { assertComponentsInPage } from '../common/page-guards.js';
import { PrismaService } from '../infra/prisma.service.js';

type TemplateInput = z.infer<typeof incidentTemplateSchema>;

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(pageId: string) {
    return this.prisma.client.incidentTemplate.findMany({
      where: { pageId },
      orderBy: { name: 'asc' },
    });
  }

  async create(pageId: string, input: TemplateInput, audit: AuditContext) {
    await assertComponentsInPage(this.prisma.client, pageId, input.componentIds);
    return this.write(async (tx) => {
      const template = await tx.incidentTemplate.create({ data: { pageId, ...input } });
      await recordAudit(tx, {
        ...audit,
        action: 'incident_template.create',
        entityType: 'incident_template',
        entityId: template.id,
        pageId,
        after: template,
      });
      return template;
    });
  }

  async update(pageId: string, templateId: string, input: TemplateInput, audit: AuditContext) {
    const before = await this.find(pageId, templateId);
    await assertComponentsInPage(this.prisma.client, pageId, input.componentIds);
    return this.write(async (tx) => {
      const template = await tx.incidentTemplate.update({ where: { id: templateId }, data: input });
      await recordAudit(tx, {
        ...audit,
        action: 'incident_template.update',
        entityType: 'incident_template',
        entityId: templateId,
        pageId,
        before,
        after: template,
      });
      return template;
    });
  }

  async remove(pageId: string, templateId: string, audit: AuditContext): Promise<void> {
    const before = await this.find(pageId, templateId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.incidentTemplate.delete({ where: { id: templateId } });
      await recordAudit(tx, {
        ...audit,
        action: 'incident_template.delete',
        entityType: 'incident_template',
        entityId: templateId,
        pageId,
        before,
      });
    });
  }

  private async find(pageId: string, templateId: string) {
    const template = await this.prisma.client.incidentTemplate.findFirst({
      where: { id: templateId, pageId },
    });
    if (!template) throw new NotFoundException({ message: 'template_not_found' });
    return template;
  }

  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.client.$transaction(fn);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ message: 'template_name_taken' });
      }
      throw error;
    }
  }
}
