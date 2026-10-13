import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { type AuditContext } from '@status-page/core';
import { themeSchema, type Theme } from '@status-page/shared';
import { RequirePageRole } from '../common/decorators.js';
import { Audit } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ThemeService } from './theme.service.js';

@Controller('pages/:pageId/theme')
export class ThemeController {
  constructor(private readonly themes: ThemeService) {}

  @Get()
  @RequirePageRole('admin')
  get(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.themes.get(pageId);
  }

  @Put('draft')
  @RequirePageRole('admin')
  saveDraft(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(themeSchema)) body: Theme,
    @Audit() audit: AuditContext,
  ) {
    return this.themes.saveDraft(pageId, body, audit);
  }

  @Post('publish')
  @RequirePageRole('admin')
  @HttpCode(200)
  publish(@Param('pageId', ParseUUIDPipe) pageId: string, @Audit() audit: AuditContext) {
    return this.themes.publish(pageId, audit);
  }

  @Post('discard')
  @RequirePageRole('admin')
  @HttpCode(200)
  discard(@Param('pageId', ParseUUIDPipe) pageId: string, @Audit() audit: AuditContext) {
    return this.themes.discardDraft(pageId, audit);
  }
}
