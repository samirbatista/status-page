import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type AuditContext, recordAudit } from '@status-page/core';
import { Prisma } from '@status-page/db';
import { PrismaService } from '../infra/prisma.service.js';

/** Nome do registro TXT de verificação e prefixo do valor esperado. */
export const VERIFICATION_PREFIX = '_status-page';
const VALUE_PREFIX = 'status-page-verification=';

export type TxtResolver = (name: string) => Promise<string[][]>;

@Injectable()
export class DomainsService {
  /** Substituível nos testes. */
  resolver: TxtResolver = resolveTxt;

  constructor(private readonly prisma: PrismaService) {}

  async list(pageId: string) {
    const domains = await this.prisma.client.pageDomain.findMany({
      where: { pageId },
      orderBy: { createdAt: 'asc' },
    });
    return domains.map((d) => this.present(d));
  }

  async create(pageId: string, hostname: string, audit: AuditContext) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const domain = await tx.pageDomain.create({
          data: { pageId, hostname, verificationToken: randomBytes(16).toString('hex') },
        });
        await recordAudit(tx, {
          ...audit,
          action: 'domain.create',
          entityType: 'domain',
          entityId: domain.id,
          pageId,
          after: { hostname },
        });
        return this.present(domain);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ message: 'domain_taken' });
      }
      throw error;
    }
  }

  /** Confere o registro TXT e marca o domínio como verificado. */
  async verify(pageId: string, domainId: string, audit: AuditContext) {
    const domain = await this.find(pageId, domainId);
    const record = this.present(domain).record;
    let values: string[];
    try {
      values = (await this.resolver(record.name)).map((chunks) => chunks.join(''));
    } catch {
      values = [];
    }
    if (!values.includes(record.value)) {
      throw new BadRequestException({ message: 'verification_failed', record });
    }
    return this.markVerified(domain.id, pageId, 'domain.verify', audit);
  }

  /** Verificação manual pelo Dono (redes internas sem DNS público, por exemplo). */
  async forceVerify(pageId: string, domainId: string, audit: AuditContext) {
    const domain = await this.find(pageId, domainId);
    return this.markVerified(domain.id, pageId, 'domain.force_verify', audit);
  }

  async remove(pageId: string, domainId: string, audit: AuditContext): Promise<void> {
    const domain = await this.find(pageId, domainId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.pageDomain.delete({ where: { id: domainId } });
      await recordAudit(tx, {
        ...audit,
        action: 'domain.delete',
        entityType: 'domain',
        entityId: domainId,
        pageId,
        before: { hostname: domain.hostname },
      });
    });
  }

  /** Página servida num domínio próprio verificado (porta e maiúsculas ignoradas). */
  async resolveHost(host: string): Promise<{ slug: string } | null> {
    const hostname = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    const domain = await this.prisma.client.pageDomain.findUnique({
      where: { hostname },
      include: { page: { select: { slug: true } } },
    });
    return domain?.verifiedAt ? { slug: domain.page.slug } : null;
  }

  private async markVerified(
    domainId: string,
    pageId: string,
    action: string,
    audit: AuditContext,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const domain = await tx.pageDomain.update({
        where: { id: domainId },
        data: { verifiedAt: new Date() },
      });
      await recordAudit(tx, {
        ...audit,
        action,
        entityType: 'domain',
        entityId: domainId,
        pageId,
        after: { hostname: domain.hostname },
      });
      return this.present(domain);
    });
  }

  private async find(pageId: string, domainId: string) {
    const domain = await this.prisma.client.pageDomain.findFirst({
      where: { id: domainId, pageId },
    });
    if (!domain) throw new NotFoundException({ message: 'domain_not_found' });
    return domain;
  }

  private present(domain: {
    id: string;
    hostname: string;
    verificationToken: string;
    verifiedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: domain.id,
      hostname: domain.hostname,
      verifiedAt: domain.verifiedAt,
      createdAt: domain.createdAt,
      record: {
        type: 'TXT' as const,
        name: `${VERIFICATION_PREFIX}.${domain.hostname}`,
        value: `${VALUE_PREFIX}${domain.verificationToken}`,
      },
    };
  }
}
