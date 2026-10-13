import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type AuditContext, isValidTimeZone, recordAudit } from '@status-page/core';
import { Prisma } from '@status-page/db';
import { type PageCreateInput } from '@status-page/shared';
import { type AuthContext } from '../common/auth.types.js';
import { PrismaService } from '../infra/prisma.service.js';

export const DEFAULT_PAGE_SETTING = 'defaultPageId';

type PageUpdateInput = Partial<Omit<PageCreateInput, 'slug'>>;

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthContext) {
    const pages = await this.prisma.client.page.findMany({
      where: auth.user.isOwner ? {} : { id: { in: [...auth.pageRoles.keys()] } },
      orderBy: { name: 'asc' },
    });
    const defaultPageId = await this.defaultPageId();
    return pages.map((p) => ({ ...p, isDefault: p.id === defaultPageId }));
  }

  async get(pageId: string) {
    const page = await this.prisma.client.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException({ message: 'page_not_found' });
    return { ...page, isDefault: page.id === (await this.defaultPageId()) };
  }

  async create(input: PageCreateInput, audit: AuditContext) {
    this.assertTimeZone(input.timezone);
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const page = await tx.page.create({ data: input });
        // A primeira página criada vira a página padrão (exibida em `/`).
        const hasDefault = await tx.setting.findUnique({ where: { key: DEFAULT_PAGE_SETTING } });
        if (!hasDefault) {
          await tx.setting.create({ data: { key: DEFAULT_PAGE_SETTING, value: page.id } });
        }
        await recordAudit(tx, {
          ...audit,
          action: 'page.create',
          entityType: 'page',
          entityId: page.id,
          pageId: page.id,
          after: page,
        });
        return page;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ message: 'slug_taken' });
      }
      throw error;
    }
  }

  async update(pageId: string, input: PageUpdateInput, audit: AuditContext) {
    if (input.timezone) this.assertTimeZone(input.timezone);
    const before = await this.get(pageId);
    return this.prisma.client.$transaction(async (tx) => {
      const page = await tx.page.update({ where: { id: pageId }, data: input });
      await recordAudit(tx, {
        ...audit,
        action: 'page.update',
        entityType: 'page',
        entityId: pageId,
        pageId,
        before,
        after: page,
      });
      return page;
    });
  }

  async remove(pageId: string, audit: AuditContext): Promise<void> {
    const before = await this.get(pageId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.page.delete({ where: { id: pageId } });
      // Componentes que não aparecem em nenhuma outra página são removidos junto.
      await tx.component.deleteMany({ where: { pages: { none: {} } } });
      if (before.isDefault) {
        const next = await tx.page.findFirst({ orderBy: { createdAt: 'asc' } });
        if (next) {
          await tx.setting.update({
            where: { key: DEFAULT_PAGE_SETTING },
            data: { value: next.id },
          });
        } else {
          await tx.setting.delete({ where: { key: DEFAULT_PAGE_SETTING } });
        }
      }
      await recordAudit(tx, {
        ...audit,
        action: 'page.delete',
        entityType: 'page',
        entityId: pageId,
        before,
      });
    });
  }

  async setDefault(pageId: string, audit: AuditContext): Promise<void> {
    await this.get(pageId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: DEFAULT_PAGE_SETTING },
        create: { key: DEFAULT_PAGE_SETTING, value: pageId },
        update: { value: pageId },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'page.set_default',
        entityType: 'page',
        entityId: pageId,
        pageId,
      });
    });
  }

  async defaultPageId(): Promise<string | null> {
    const setting = await this.prisma.client.setting.findUnique({
      where: { key: DEFAULT_PAGE_SETTING },
    });
    if (typeof setting?.value === 'string') return setting.value;
    const first = await this.prisma.client.page.findFirst({ orderBy: { createdAt: 'asc' } });
    return first?.id ?? null;
  }

  private assertTimeZone(timeZone: string): void {
    if (!isValidTimeZone(timeZone)) throw new BadRequestException({ message: 'invalid_timezone' });
  }
}
