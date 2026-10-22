import {
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
import { type AuditContext } from '@status-page/core';
import {
  mfaVerifySchema,
  totpCodeSchema,
  webauthnRegisterSchema,
  webauthnResponseSchema,
} from '@status-page/shared';
import { type z } from 'zod';
import { type AuthContext } from '../common/auth.types.js';
import { AllowMfaStage } from '../common/decorators.js';
import { RateLimitService } from '../common/rate-limit.service.js';
import { Audit, CurrentAuth } from '../common/request-meta.js';
import { ZodBody } from '../common/zod.pipe.js';
import { type MfaCompletion, MfaService } from './mfa.service.js';
import { relyingParty, setSessionCookie } from './session-cookie.js';
import { SessionService } from './session.service.js';

/**
 * Segundo fator: cadastro (perfil ou cadastro obrigatório pela política) e
 * verificação logo após a senha.
 */
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get()
  @AllowMfaStage('enroll', 'pending')
  status(@CurrentAuth() auth: AuthContext) {
    return this.mfa.status(auth);
  }

  // --- Verificação (sessão com MFA pendente) ---------------------------------

  @Post('verify')
  @HttpCode(200)
  @AllowMfaStage('pending')
  async verify(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(mfaVerifySchema) body: z.infer<typeof mfaVerifySchema>,
    @Audit() audit: AuditContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.rateLimit.enforce(`mfa:${audit.ip}`, 30, 60);
    return this.finish(req, res, await this.mfa.verify(auth, body, audit));
  }

  @Post('webauthn/authenticate/options')
  @HttpCode(200)
  @AllowMfaStage('pending')
  authenticationOptions(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return this.mfa.webauthnAuthenticationOptions(auth, relyingParty(req));
  }

  @Post('webauthn/authenticate')
  @HttpCode(200)
  @AllowMfaStage('pending')
  async authenticate(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(webauthnResponseSchema) body: z.infer<typeof webauthnResponseSchema>,
    @Audit() audit: AuditContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.rateLimit.enforce(`mfa:${audit.ip}`, 30, 60);
    const done = await this.mfa.webauthnAuthenticate(auth, relyingParty(req), body.response, audit);
    return this.finish(req, res, done);
  }

  // --- Cadastro ----------------------------------------------------------------

  @Post('totp/setup')
  @HttpCode(200)
  @AllowMfaStage('enroll')
  totpSetup(@CurrentAuth() auth: AuthContext) {
    return this.mfa.totpSetup(auth);
  }

  @Post('totp/confirm')
  @HttpCode(200)
  @AllowMfaStage('enroll')
  async totpConfirm(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(totpCodeSchema) body: z.infer<typeof totpCodeSchema>,
    @Audit() audit: AuditContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.finish(req, res, await this.mfa.totpConfirm(auth, body.code, audit));
  }

  @Delete('totp')
  @HttpCode(204)
  async totpDisable(@CurrentAuth() auth: AuthContext, @Audit() audit: AuditContext) {
    await this.mfa.totpDisable(auth, audit);
  }

  @Post('webauthn/register/options')
  @HttpCode(200)
  @AllowMfaStage('enroll')
  registrationOptions(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return this.mfa.webauthnRegistrationOptions(auth, relyingParty(req));
  }

  @Post('webauthn/register')
  @HttpCode(200)
  @AllowMfaStage('enroll')
  async register(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(webauthnRegisterSchema) body: z.infer<typeof webauthnRegisterSchema>,
    @Audit() audit: AuditContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const done = await this.mfa.webauthnRegister(auth, relyingParty(req), body, audit);
    return this.finish(req, res, done);
  }

  @Delete('webauthn/:id')
  @HttpCode(204)
  async webauthnRemove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Audit() audit: AuditContext,
  ) {
    await this.mfa.webauthnRemove(auth, id, audit);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  async regenerate(@CurrentAuth() auth: AuthContext, @Audit() audit: AuditContext) {
    return { recoveryCodes: await this.mfa.regenerateRecoveryCodes(auth, audit) };
  }

  /** Troca o cookie pelo token novo da sessão (agora com MFA confirmado). */
  private finish(req: Request, res: Response, done: MfaCompletion) {
    if (done.token) setSessionCookie(req, res, done.token, this.sessions.maxAgeMs);
    return { ok: true, recoveryCodes: done.recoveryCodes ?? null };
  }
}
