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
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { type AuditContext } from '@status-page/core';
import {
  authSettingsSchema,
  changePasswordSchema,
  loginSchema,
  type AuthSettings,
  type LoginInput,
} from '@status-page/shared';
import { type AuthContext } from '../common/auth.types.js';
import { AllowMfaStage, Public, RequireOwner } from '../common/decorators.js';
import { RateLimitService } from '../common/rate-limit.service.js';
import { Audit, CurrentAuth, requestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuthSettingsService } from './auth-settings.service.js';
import { AuthService } from './auth.service.js';
import { setSessionCookie } from './session-cookie.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly rateLimit: RateLimitService,
    private readonly settings: AuthSettingsService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta = requestMeta(req);
    await this.rateLimit.enforce(`login:${meta.ip}`, 20, 60);
    const { session, mfa } = await this.auth.login(body, meta);
    setSessionCookie(req, res, session.token, this.sessions.maxAgeMs);
    // `mfa`: `pending` pede o segundo fator; `enroll`, o cadastro obrigatório.
    return { ok: true, mfa: mfa === 'ok' ? null : mfa };
  }

  @Post('logout')
  @HttpCode(204)
  @AllowMfaStage('pending', 'enroll')
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth, requestMeta(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @AllowMfaStage('pending', 'enroll')
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @Get('sessions')
  sessionsList(@CurrentAuth() auth: AuthContext) {
    return this.auth.listSessions(auth);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.revokeSession(auth, sessionId, requestMeta(req));
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(changePasswordSchema)) body: { currentPassword: string; newPassword: string },
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.changePassword(auth, body, requestMeta(req));
  }

  // --- Política de autenticação (Dono) ---------------------------------------

  @Get('settings')
  @RequireOwner()
  settingsGet() {
    return this.settings.get();
  }

  @Put('settings')
  @RequireOwner()
  settingsUpdate(
    @Body(new ZodPipe(authSettingsSchema)) body: AuthSettings,
    @Audit() audit: AuditContext,
  ) {
    return this.settings.update(body, audit);
  }
}
