import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { changePasswordSchema, loginSchema, type LoginInput } from '@status-page/shared';
import { type AuthContext } from '../common/auth.types.js';
import { Public } from '../common/decorators.js';
import { RateLimitService } from '../common/rate-limit.service.js';
import { CurrentAuth, requestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly rateLimit: RateLimitService,
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
    const session = await this.auth.login(body, meta);
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      // Atrás do Caddy com HTTPS, req.secure vem do X-Forwarded-Proto.
      secure: req.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.sessions.maxAgeMs,
    });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth, requestMeta(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
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
}
