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
  Put,
} from '@nestjs/common';
import { type AuditContext } from '@status-page/core';
import { pageCreateSchema, pageUpdateSchema, type PageCreateInput } from '@status-page/shared';
import { type AuthContext } from '../common/auth.types.js';
import { RequireOwner, RequirePageRole } from '../common/decorators.js';
import { Audit, CurrentAuth } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type z } from 'zod';
import { PagesService } from './pages.service.js';

@Controller('pages')
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.pages.list(auth);
  }

  @Post()
  @RequireOwner()
  create(@Body(new ZodPipe(pageCreateSchema)) body: PageCreateInput, @Audit() audit: AuditContext) {
    return this.pages.create(body, audit);
  }

  @Get(':pageId')
  @RequirePageRole('viewer')
  get(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.pages.get(pageId);
  }

  @Patch(':pageId')
  @RequirePageRole('admin')
  update(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(pageUpdateSchema)) body: z.infer<typeof pageUpdateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.pages.update(pageId, body, audit);
  }

  @Delete(':pageId')
  @RequireOwner()
  @HttpCode(204)
  async remove(@Param('pageId', ParseUUIDPipe) pageId: string, @Audit() audit: AuditContext) {
    await this.pages.remove(pageId, audit);
  }

  @Put(':pageId/default')
  @RequireOwner()
  @HttpCode(204)
  async setDefault(@Param('pageId', ParseUUIDPipe) pageId: string, @Audit() audit: AuditContext) {
    await this.pages.setDefault(pageId, audit);
  }
}
