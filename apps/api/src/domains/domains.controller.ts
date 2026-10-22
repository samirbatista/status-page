import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { type AuditContext } from '@status-page/core';
import { domainCreateSchema } from '@status-page/shared';
import { z } from 'zod';
import { Public, RequireOwner, RequirePageRole } from '../common/decorators.js';
import { Audit } from '../common/request-meta.js';
import { ZodBody, ZodQuery } from '../common/zod.pipe.js';
import { DomainsService } from './domains.service.js';

const hostQuery = z.object({ host: z.string().trim().min(1).max(260) });
const askQuery = z.object({ domain: z.string().trim().min(1).max(260) });

@Controller()
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get('pages/:pageId/domains')
  @RequirePageRole('admin')
  list(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.domains.list(pageId);
  }

  @Post('pages/:pageId/domains')
  @RequirePageRole('admin')
  create(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodBody(domainCreateSchema) body: z.infer<typeof domainCreateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.domains.create(pageId, body.hostname, audit);
  }

  @Post('pages/:pageId/domains/:domainId/verify')
  @RequirePageRole('admin')
  @HttpCode(200)
  verify(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Audit() audit: AuditContext,
  ) {
    return this.domains.verify(pageId, domainId, audit);
  }

  @Post('pages/:pageId/domains/:domainId/force-verify')
  @RequireOwner()
  @HttpCode(200)
  forceVerify(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Audit() audit: AuditContext,
  ) {
    return this.domains.forceVerify(pageId, domainId, audit);
  }

  @Delete('pages/:pageId/domains/:domainId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async remove(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.domains.remove(pageId, domainId, audit);
  }

  /** Usado pelo site para descobrir qual página servir em cada domínio. */
  @Public()
  @Get('public/resolve-host')
  async resolveHost(@ZodQuery(hostQuery) query: z.infer<typeof hostQuery>) {
    const result = await this.domains.resolveHost(query.host);
    if (!result) throw new NotFoundException({ message: 'domain_not_found' });
    return result;
  }

  /**
   * Endpoint `ask` do TLS on-demand do Caddy: só emite certificado para domínios
   * verificados. O Caddy bloqueia `/api/internal/*` vindo de fora.
   */
  @Public()
  @Get('internal/tls-ask')
  async tlsAsk(@ZodQuery(askQuery) query: z.infer<typeof askQuery>) {
    const result = await this.domains.resolveHost(query.domain);
    if (!result) throw new NotFoundException({ message: 'domain_not_found' });
    return { ok: true };
  }
}
