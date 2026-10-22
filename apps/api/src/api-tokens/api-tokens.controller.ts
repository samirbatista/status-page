import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type AuditContext } from '@status-page/core';
import { type ApiTokenCreateInput, apiTokenCreateSchema } from '@status-page/shared';
import { type AuthContext } from '../common/auth.types.js';
import { RequirePageRole, SessionOnly } from '../common/decorators.js';
import { Audit, CurrentAuth } from '../common/request-meta.js';
import { ZodBody } from '../common/zod.pipe.js';
import { ApiTokensService } from './api-tokens.service.js';

/** Gestão de tokens: só pelo painel (um token não cria outro). */
@SessionOnly()
@Controller('pages/:pageId/api-tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  @RequirePageRole('admin')
  list(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.tokens.list(pageId);
  }

  @Post()
  @RequirePageRole('admin')
  create(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodBody(apiTokenCreateSchema) body: ApiTokenCreateInput,
    @CurrentAuth() auth: AuthContext,
    @Audit() audit: AuditContext,
  ) {
    return this.tokens.create(pageId, body, auth, audit);
  }

  @Delete(':tokenId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async revoke(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.tokens.revoke(pageId, tokenId, audit);
  }
}
