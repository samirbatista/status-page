import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { type AuditContext } from '@status-page/core';
import {
  incidentCreateSchema,
  incidentEditSchema,
  incidentUpdateCreateSchema,
  type IncidentCreateInput,
  type IncidentUpdateCreateInput,
} from '@status-page/shared';
import { z } from 'zod';
import { RequirePageRole } from '../common/decorators.js';
import { listQuerySchema } from '../common/list-query.js';
import { Audit } from '../common/request-meta.js';
import { ZodBody, ZodQuery } from '../common/zod.pipe.js';
import { IncidentsService } from './incidents.service.js';

const incidentListSchema = listQuerySchema.extend({
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

@Controller('pages/:pageId/incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @RequirePageRole('viewer')
  list(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodQuery(incidentListSchema) query: z.infer<typeof incidentListSchema>,
  ) {
    return this.incidents.list(pageId, query);
  }

  @Get(':incidentId')
  @RequirePageRole('viewer')
  get(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
  ) {
    return this.incidents.get(pageId, incidentId);
  }

  @Post()
  @RequirePageRole('operator')
  create(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodBody(incidentCreateSchema) body: IncidentCreateInput,
    @Audit() audit: AuditContext,
  ) {
    return this.incidents.create(pageId, body, audit);
  }

  @Post(':incidentId/updates')
  @RequirePageRole('operator')
  addUpdate(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @ZodBody(incidentUpdateCreateSchema) body: IncidentUpdateCreateInput,
    @Audit() audit: AuditContext,
  ) {
    return this.incidents.addUpdate(pageId, incidentId, body, audit);
  }

  @Patch(':incidentId')
  @RequirePageRole('operator')
  edit(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @ZodBody(incidentEditSchema) body: z.infer<typeof incidentEditSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.incidents.edit(pageId, incidentId, body, audit);
  }

  @Delete(':incidentId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async remove(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.incidents.remove(pageId, incidentId, audit);
  }
}
