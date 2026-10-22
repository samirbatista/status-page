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
  maintenanceCreateSchema,
  maintenanceEditSchema,
  maintenanceStatusSchema,
  maintenanceUpdateCreateSchema,
  type MaintenanceCreateInput,
} from '@status-page/shared';
import { type z } from 'zod';
import { RequirePageRole } from '../common/decorators.js';
import { listQuerySchema } from '../common/list-query.js';
import { Audit } from '../common/request-meta.js';
import { ZodBody, ZodQuery } from '../common/zod.pipe.js';
import { MaintenancesService } from './maintenances.service.js';

const maintenanceListSchema = listQuerySchema.extend({
  status: maintenanceStatusSchema.optional(),
});

@Controller('pages/:pageId/maintenances')
export class MaintenancesController {
  constructor(private readonly maintenances: MaintenancesService) {}

  @Get()
  @RequirePageRole('viewer')
  list(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodQuery(maintenanceListSchema) query: z.infer<typeof maintenanceListSchema>,
  ) {
    return this.maintenances.list(pageId, query);
  }

  @Get(':maintenanceId')
  @RequirePageRole('viewer')
  get(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('maintenanceId', ParseUUIDPipe) maintenanceId: string,
  ) {
    return this.maintenances.get(pageId, maintenanceId);
  }

  @Post()
  @RequirePageRole('operator')
  create(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @ZodBody(maintenanceCreateSchema) body: MaintenanceCreateInput,
    @Audit() audit: AuditContext,
  ) {
    return this.maintenances.create(pageId, body, audit);
  }

  @Patch(':maintenanceId')
  @RequirePageRole('operator')
  edit(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('maintenanceId', ParseUUIDPipe) maintenanceId: string,
    @ZodBody(maintenanceEditSchema) body: z.infer<typeof maintenanceEditSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.maintenances.edit(pageId, maintenanceId, body, audit);
  }

  @Post(':maintenanceId/updates')
  @RequirePageRole('operator')
  addUpdate(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('maintenanceId', ParseUUIDPipe) maintenanceId: string,
    @ZodBody(maintenanceUpdateCreateSchema)
    body: z.infer<typeof maintenanceUpdateCreateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.maintenances.addUpdate(pageId, maintenanceId, body, audit);
  }

  @Delete(':maintenanceId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async remove(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('maintenanceId', ParseUUIDPipe) maintenanceId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.maintenances.remove(pageId, maintenanceId, audit);
  }
}
