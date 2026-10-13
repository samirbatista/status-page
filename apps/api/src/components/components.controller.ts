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
import {
  componentCreateSchema,
  componentStatusUpdateSchema,
  componentUpdateSchema,
  groupCreateSchema,
  groupUpdateSchema,
  layoutSchema,
  type ComponentCreateInput,
  type ComponentStatus,
} from '@status-page/shared';
import { z } from 'zod';
import { RequireOwner, RequirePageRole } from '../common/decorators.js';
import { Audit } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ComponentsService } from './components.service.js';

const attachSchema = z.object({ componentId: z.uuid() });

@Controller('pages/:pageId')
export class ComponentsController {
  constructor(private readonly components: ComponentsService) {}

  @Get('structure')
  @RequirePageRole('viewer')
  structure(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.components.structure(pageId);
  }

  @Put('layout')
  @RequirePageRole('admin')
  @HttpCode(204)
  async layout(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(layoutSchema)) body: z.infer<typeof layoutSchema>,
    @Audit() audit: AuditContext,
  ) {
    await this.components.setLayout(pageId, body, audit);
  }

  @Post('groups')
  @RequirePageRole('admin')
  createGroup(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(groupCreateSchema)) body: z.infer<typeof groupCreateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.components.createGroup(pageId, body, audit);
  }

  @Patch('groups/:groupId')
  @RequirePageRole('admin')
  updateGroup(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodPipe(groupUpdateSchema)) body: z.infer<typeof groupUpdateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.components.updateGroup(pageId, groupId, body, audit);
  }

  @Delete('groups/:groupId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async removeGroup(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.components.removeGroup(pageId, groupId, audit);
  }

  @Post('components')
  @RequirePageRole('admin')
  create(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(componentCreateSchema)) body: ComponentCreateInput,
    @Audit() audit: AuditContext,
  ) {
    return this.components.create(pageId, body, audit);
  }

  /** Vincular componentes entre páginas exige o Dono (acesso às duas páginas). */
  @Post('components/attach')
  @RequireOwner()
  attach(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(new ZodPipe(attachSchema)) body: z.infer<typeof attachSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.components.attach(pageId, body.componentId, audit);
  }

  @Patch('components/:componentId')
  @RequirePageRole('admin')
  update(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('componentId', ParseUUIDPipe) componentId: string,
    @Body(new ZodPipe(componentUpdateSchema)) body: z.infer<typeof componentUpdateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.components.update(pageId, componentId, body, audit);
  }

  @Delete('components/:componentId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async remove(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('componentId', ParseUUIDPipe) componentId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.components.remove(pageId, componentId, audit);
  }

  @Put('components/:componentId/status')
  @RequirePageRole('operator')
  setStatus(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('componentId', ParseUUIDPipe) componentId: string,
    @Body(new ZodPipe(componentStatusUpdateSchema)) body: { status: ComponentStatus },
    @Audit() audit: AuditContext,
  ) {
    return this.components.setStatus(pageId, componentId, body.status, audit);
  }
}
