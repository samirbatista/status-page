import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { type AuditContext } from '@status-page/core';
import {
  pageRoleSchema,
  resetPasswordSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@status-page/shared';
import { z } from 'zod';
import { type AuthContext } from '../common/auth.types.js';
import { RequireOwner, RequirePageRole } from '../common/decorators.js';
import { Audit, CurrentAuth } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { UsersService } from './users.service.js';

const directoryQuery = z.object({ q: z.string().trim().max(100).default('') });
const roleBody = z.object({ role: pageRoleSchema });

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequireOwner()
  list() {
    return this.users.list();
  }

  @Post('users')
  @RequireOwner()
  create(
    @Body(new ZodPipe(userCreateSchema)) body: z.infer<typeof userCreateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.users.create(body, audit);
  }

  @Patch('users/:userId')
  @RequireOwner()
  update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(userUpdateSchema)) body: z.infer<typeof userUpdateSchema>,
    @Audit() audit: AuditContext,
  ) {
    return this.users.update(userId, body, audit);
  }

  @Post('users/:userId/password')
  @RequireOwner()
  @HttpCode(204)
  async resetPassword(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: { password: string },
    @Audit() audit: AuditContext,
  ) {
    await this.users.resetPassword(userId, body.password, audit);
  }

  /** Busca de usuários para adicionar à equipe; disponível para Admins de alguma página. */
  @Get('users/directory')
  directory(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(directoryQuery)) query: z.infer<typeof directoryQuery>,
  ) {
    const isAdmin = auth.user.isOwner || [...auth.pageRoles.values()].includes('admin');
    if (!isAdmin) throw new ForbiddenException({ message: 'forbidden' });
    return this.users.directory(query.q);
  }

  @Get('pages/:pageId/team')
  @RequirePageRole('admin')
  team(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.users.team(pageId);
  }

  @Put('pages/:pageId/team/:userId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async setRole(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(roleBody)) body: z.infer<typeof roleBody>,
    @Audit() audit: AuditContext,
  ) {
    await this.users.setRole(pageId, userId, body.role, audit);
  }

  @Delete('pages/:pageId/team/:userId')
  @RequirePageRole('admin')
  @HttpCode(204)
  async removeRole(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Audit() audit: AuditContext,
  ) {
    await this.users.removeRole(pageId, userId, audit);
  }
}
