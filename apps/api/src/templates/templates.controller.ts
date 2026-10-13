import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { type AuditContext } from '@status-page/core';
import { incidentTemplateSchema } from '@status-page/shared';
import { type z } from 'zod';
import { RequirePageRole } from '../common/decorators.js';
import { Audit } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TemplatesService } from './templates.service.js';

type TemplateInput = z.infer<typeof incidentTemplateSchema>;

@Controller('pages/:pageId/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePageRole('viewer')
  list(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.templates.list(pageId);
  }

  @Post()
  @RequirePageRole('admin')
  create(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(incidentTemplateSchema)) body: TemplateInput,
    @Audit() audit: AuditContext,
  ) {
    return this.templates.create(pageId, body, audit);
  }

  @Put(':templateId')
  @RequirePageRole('admin')
  update(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body(new ZodPipe(incidentTemplateSchema)) body: TemplateInput,
    @Audit() audit: AuditContext,
  ) {
    return this.templates.update(pageId, templateId, body, audit);
  }

  @Delete(':templateId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async remove(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.templates.remove(pageId, templateId, audit);
  }
}
