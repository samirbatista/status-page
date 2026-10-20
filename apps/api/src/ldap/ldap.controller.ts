import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { type AuditContext } from '@status-page/core';
import {
  ldapConnectionTestSchema,
  ldapLoginTestSchema,
  ldapMappingCreateSchema,
  ldapProviderCreateSchema,
  ldapProviderUpdateSchema,
} from '@status-page/shared';
import { type z } from 'zod';
import { RequireOwner } from '../common/decorators.js';
import { RateLimitService } from '../common/rate-limit.service.js';
import { Audit, requestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { LdapService } from './ldap.service.js';

/** Provedores LDAP e mapeamento de grupos: configuração global, só o Dono. */
@Controller('ldap/providers')
@RequireOwner()
export class LdapController {
  constructor(
    private readonly ldap: LdapService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get()
  list() {
    return this.ldap.list();
  }

  @Post()
  create(
    @Body(new ZodPipe(ldapProviderCreateSchema)) body: z.infer<typeof ldapProviderCreateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.ldap.create(body, audit);
  }

  /** Teste de conexão com o formulário ainda não salvo. */
  @Post('test-connection')
  @HttpCode(200)
  async testConnection(
    @Body(new ZodPipe(ldapConnectionTestSchema)) body: z.infer<typeof ldapConnectionTestSchema>,
    @Req() req: Request,
  ) {
    await this.rateLimit.enforce(`ldap-test:${requestMeta(req).ip}`, 30, 60);
    return this.ldap.testConnection(body);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.ldap.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ldapProviderUpdateSchema)) body: z.infer<typeof ldapProviderUpdateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.ldap.update(id, body, audit);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Audit() audit: AuditContext) {
    await this.ldap.remove(id, audit);
  }

  @Post(':id/test-login')
  @HttpCode(200)
  async testLogin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ldapLoginTestSchema)) body: z.infer<typeof ldapLoginTestSchema>,
    @Req() req: Request,
    @Audit() audit: AuditContext,
  ) {
    await this.rateLimit.enforce(`ldap-test:${requestMeta(req).ip}`, 30, 60);
    return this.ldap.testLogin(id, body.username, body.password, audit);
  }

  @Post(':id/sync')
  @HttpCode(200)
  sync(@Param('id', ParseUUIDPipe) id: string, @Audit() audit: AuditContext) {
    return this.ldap.syncNow(id, audit);
  }

  @Post(':id/mappings')
  addMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ldapMappingCreateSchema)) body: z.infer<typeof ldapMappingCreateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.ldap.addMapping(id, body, audit);
  }

  @Delete(':id/mappings/:mappingId')
  @HttpCode(204)
  async removeMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mappingId', ParseUUIDPipe) mappingId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.ldap.removeMapping(id, mappingId, audit);
  }
}
