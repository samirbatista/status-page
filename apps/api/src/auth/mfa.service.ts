import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import {
  type AuditContext,
  type Db,
  generateTotpSecret,
  recordAudit,
  totpUri,
  verifyTotp,
} from '@status-page/core';
import { mfaRequiredFor } from '@status-page/shared';
import QRCode from 'qrcode';
import { type AuthContext } from '../common/auth.types.js';
import { tooManyRequests } from '../common/rate-limit.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { SecretsService } from '../infra/secrets.service.js';
import { AuthSettingsService } from './auth-settings.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { SessionService } from './session.service.js';

/** Domínio e origem do painel, de onde vêm as cerimônias WebAuthn. */
export interface RelyingParty {
  rpID: string;
  origin: string;
}

const ISSUER = 'Status Page';
const RECOVERY_CODE_COUNT = 10;
/** Sem 0/O, 1/I/L: códigos fáceis de digitar a partir do papel. */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CHALLENGE_TTL_SECONDS = 300;

/** Mudança que concluiu o segundo fator: o controller troca o cookie pelo novo token. */
export interface MfaCompletion {
  /** Novo token de sessão (troca após confirmar o fator). */
  token?: string;
  /** Mostrados uma única vez, quando o primeiro fator é cadastrado. */
  recoveryCodes?: string[];
}

function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly secrets: SecretsService,
    private readonly settings: AuthSettingsService,
    private readonly throttle: LoginThrottleService,
    private readonly sessions: SessionService,
  ) {}

  // --- Estado ------------------------------------------------------------------

  async status(auth: AuthContext) {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      include: {
        totp: { select: { confirmedAt: true } },
        webauthn: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, createdAt: true, lastUsedAt: true, rpId: true },
        },
        recoveryCodes: { where: { usedAt: null }, select: { id: true } },
        pageRoles: { select: { role: true } },
      },
    });
    const policy = (await this.settings.get()).mfa;
    return {
      stage: auth.mfa,
      required: mfaRequiredFor(policy, {
        isOwner: user.isOwner,
        roles: user.pageRoles.map((r) => r.role),
      }),
      totp: Boolean(user.totp?.confirmedAt),
      webauthn: user.webauthn,
      recoveryCodesRemaining: user.recoveryCodes.length,
    };
  }

  private async factorCount(db: Db, userId: string): Promise<number> {
    const [totp, keys] = await Promise.all([
      db.totpSecret.count({ where: { userId, confirmedAt: { not: null } } }),
      db.webAuthnCredential.count({ where: { userId } }),
    ]);
    return totp + keys;
  }

  // --- TOTP --------------------------------------------------------------------

  /** Gera um segredo novo (ainda não confirmado) e o QR code para o aplicativo. */
  async totpSetup(auth: AuthContext) {
    const existing = await this.prisma.client.totpSecret.findUnique({
      where: { userId: auth.user.id },
    });
    if (existing?.confirmedAt) throw new ConflictException({ message: 'totp_already_enabled' });
    const secret = generateTotpSecret();
    await this.prisma.client.totpSecret.upsert({
      where: { userId: auth.user.id },
      create: { userId: auth.user.id, secretEnc: this.secrets.encrypt(secret) },
      update: { secretEnc: this.secrets.encrypt(secret), lastStep: 0 },
    });
    const uri = totpUri(secret, auth.user.email, ISSUER);
    const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { secret, uri, qrSvg };
  }

  async totpConfirm(auth: AuthContext, code: string, audit: AuditContext): Promise<MfaCompletion> {
    const row = await this.prisma.client.totpSecret.findUnique({ where: { userId: auth.user.id } });
    if (!row) throw new BadRequestException({ message: 'totp_not_started' });
    if (row.confirmedAt) throw new ConflictException({ message: 'totp_already_enabled' });
    await this.assertNotLocked(auth.user.id);
    const step = verifyTotp(this.secrets.decrypt(row.secretEnc), code);
    if (step === null) {
      await this.registerFailure(auth.user.id);
      throw new BadRequestException({ message: 'invalid_code' });
    }
    return this.enrollFactor(auth, audit, 'totp', async (tx) => {
      await tx.totpSecret.update({
        where: { userId: auth.user.id },
        data: { confirmedAt: new Date(), lastStep: BigInt(step) },
      });
    });
  }

  async totpDisable(auth: AuthContext, audit: AuditContext): Promise<void> {
    const row = await this.prisma.client.totpSecret.findUnique({ where: { userId: auth.user.id } });
    if (!row) throw new NotFoundException({ message: 'totp_not_enabled' });
    await this.removeFactor(auth, audit, 'totp', (tx) =>
      tx.totpSecret.delete({ where: { userId: auth.user.id } }),
    );
  }

  // --- WebAuthn ----------------------------------------------------------------

  async webauthnRegistrationOptions(auth: AuthContext, rp: RelyingParty) {
    const existing = await this.prisma.client.webAuthnCredential.findMany({
      where: { userId: auth.user.id, rpId: rp.rpID },
      select: { credentialId: true, transports: true },
    });
    const options = await generateRegistrationOptions({
      rpName: ISSUER,
      rpID: rp.rpID,
      userName: auth.user.email,
      userDisplayName: auth.user.name,
      userID: new TextEncoder().encode(auth.user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await this.storeChallenge('reg', auth.sessionId, options.challenge);
    return options;
  }

  async webauthnRegister(
    auth: AuthContext,
    rp: RelyingParty,
    input: { name: string; response: Record<string, unknown> },
    audit: AuditContext,
  ): Promise<MfaCompletion> {
    const expectedChallenge = await this.takeChallenge('reg', auth.sessionId);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: input.response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: false,
      });
    } catch {
      throw new BadRequestException({ message: 'webauthn_failed' });
    }
    if (!verification.verified) throw new BadRequestException({ message: 'webauthn_failed' });
    const info = verification.registrationInfo;
    return this.enrollFactor(auth, audit, 'webauthn', async (tx) => {
      await tx.webAuthnCredential.create({
        data: {
          userId: auth.user.id,
          credentialId: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey),
          counter: BigInt(info.credential.counter),
          transports: info.credential.transports ?? [],
          rpId: rp.rpID,
          name: input.name,
          backedUp: info.credentialBackedUp,
        },
      });
    });
  }

  async webauthnRemove(auth: AuthContext, id: string, audit: AuditContext): Promise<void> {
    const credential = await this.prisma.client.webAuthnCredential.findFirst({
      where: { id, userId: auth.user.id },
    });
    if (!credential) throw new NotFoundException({ message: 'webauthn_not_found' });
    await this.removeFactor(auth, audit, 'webauthn', (tx) =>
      tx.webAuthnCredential.delete({ where: { id } }),
    );
  }

  // --- Códigos de recuperação -------------------------------------------------

  async regenerateRecoveryCodes(auth: AuthContext, audit: AuditContext): Promise<string[]> {
    if ((await this.factorCount(this.prisma.client, auth.user.id)) === 0) {
      throw new BadRequestException({ message: 'mfa_not_enabled' });
    }
    return this.prisma.client.$transaction(async (tx) => {
      const codes = await this.replaceRecoveryCodes(tx, auth.user.id);
      await recordAudit(tx, {
        ...audit,
        action: 'mfa.recovery_regenerate',
        entityType: 'user',
        entityId: auth.user.id,
      });
      return codes;
    });
  }

  private async replaceRecoveryCodes(tx: Db, userId: string): Promise<string[]> {
    await tx.recoveryCode.deleteMany({ where: { userId } });
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = Array.from(
        { length: 10 },
        () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
      ).join('');
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({
        userId,
        codeHash: this.secrets.mac(normalizeRecoveryCode(code)),
      })),
    });
    return codes;
  }

  // --- Verificação no login ---------------------------------------------------

  async verify(
    auth: AuthContext,
    input: { method: 'totp' | 'recovery'; code: string },
    audit: AuditContext,
  ): Promise<MfaCompletion> {
    await this.assertNotLocked(auth.user.id);
    const ok =
      input.method === 'totp'
        ? await this.consumeTotp(auth.user.id, input.code)
        : await this.consumeRecoveryCode(auth.user.id, input.code);
    if (!ok) {
      await this.registerFailure(auth.user.id);
      await recordAudit(this.prisma.client, {
        ...audit,
        action: 'mfa.verify_failed',
        entityType: 'user',
        entityId: auth.user.id,
        after: { method: input.method },
      });
      throw new UnauthorizedException({ message: 'invalid_code' });
    }
    return this.completeVerification(auth, input.method, audit);
  }

  async webauthnAuthenticationOptions(auth: AuthContext, rp: RelyingParty) {
    const credentials = await this.prisma.client.webAuthnCredential.findMany({
      where: { userId: auth.user.id, rpId: rp.rpID },
      select: { credentialId: true, transports: true },
    });
    if (credentials.length === 0) throw new BadRequestException({ message: 'webauthn_none_here' });
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      userVerification: 'preferred',
      allowCredentials: credentials.map((c) => ({ id: c.credentialId, transports: c.transports })),
    });
    await this.storeChallenge('auth', auth.sessionId, options.challenge);
    return options;
  }

  async webauthnAuthenticate(
    auth: AuthContext,
    rp: RelyingParty,
    response: Record<string, unknown>,
    audit: AuditContext,
  ): Promise<MfaCompletion> {
    await this.assertNotLocked(auth.user.id);
    const expectedChallenge = await this.takeChallenge('auth', auth.sessionId);
    const json = response as unknown as AuthenticationResponseJSON;
    const credential = await this.prisma.client.webAuthnCredential.findFirst({
      where: { credentialId: String(json.id ?? ''), userId: auth.user.id, rpId: rp.rpID },
    });
    let verified = false;
    let newCounter = 0;
    if (credential) {
      try {
        const result = await verifyAuthenticationResponse({
          response: json,
          expectedChallenge,
          expectedOrigin: rp.origin,
          expectedRPID: rp.rpID,
          requireUserVerification: false,
          credential: {
            id: credential.credentialId,
            publicKey: new Uint8Array(credential.publicKey),
            counter: Number(credential.counter),
            transports: credential.transports,
          },
        });
        verified = result.verified;
        newCounter = result.authenticationInfo.newCounter;
      } catch {
        verified = false;
      }
    }
    if (!credential || !verified) {
      await this.registerFailure(auth.user.id);
      await recordAudit(this.prisma.client, {
        ...audit,
        action: 'mfa.verify_failed',
        entityType: 'user',
        entityId: auth.user.id,
        after: { method: 'webauthn' },
      });
      throw new UnauthorizedException({ message: 'webauthn_failed' });
    }
    await this.prisma.client.webAuthnCredential.update({
      where: { id: credential.id },
      data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
    });
    return this.completeVerification(auth, 'webauthn', audit);
  }

  // --- Redefinição pelo Dono ou Admin -----------------------------------------

  /** Apaga todos os fatores do usuário e encerra as sessões dele. */
  async reset(userId: string, audit: AuditContext): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.totpSecret.deleteMany({ where: { userId } });
      await tx.webAuthnCredential.deleteMany({ where: { userId } });
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await recordAudit(tx, {
        ...audit,
        action: 'user.mfa_reset',
        entityType: 'user',
        entityId: userId,
      });
    });
    await this.throttle.registerSuccess(`mfa:${userId}`);
  }

  // --- Internos ----------------------------------------------------------------

  /**
   * Cadastra um fator. No primeiro fator, gera os códigos de recuperação. A
   * sessão atual fica com o MFA confirmado (o usuário acabou de provar a posse).
   */
  private async enrollFactor(
    auth: AuthContext,
    audit: AuditContext,
    method: 'totp' | 'webauthn',
    write: (tx: Db) => Promise<void>,
  ): Promise<MfaCompletion> {
    const { recoveryCodes } = await this.prisma.client.$transaction(async (tx) => {
      const first = (await this.factorCount(tx, auth.user.id)) === 0;
      await write(tx);
      const codes = first ? await this.replaceRecoveryCodes(tx, auth.user.id) : undefined;
      await recordAudit(tx, {
        ...audit,
        action: 'mfa.enroll',
        entityType: 'user',
        entityId: auth.user.id,
        after: { method },
      });
      return { recoveryCodes: codes };
    });
    return { recoveryCodes, token: await this.markSessionVerified(auth.sessionId) };
  }

  private async removeFactor(
    auth: AuthContext,
    audit: AuditContext,
    method: 'totp' | 'webauthn',
    remove: (tx: Db) => Promise<unknown>,
  ): Promise<void> {
    const status = await this.status(auth);
    await this.prisma.client.$transaction(async (tx) => {
      await remove(tx);
      const left = await this.factorCount(tx, auth.user.id);
      if (left === 0) {
        if (status.required) throw new BadRequestException({ message: 'mfa_required_by_policy' });
        await tx.recoveryCode.deleteMany({ where: { userId: auth.user.id } });
      }
      await recordAudit(tx, {
        ...audit,
        action: 'mfa.remove',
        entityType: 'user',
        entityId: auth.user.id,
        after: { method, factorsLeft: left },
      });
    });
  }

  private async completeVerification(
    auth: AuthContext,
    method: 'totp' | 'webauthn' | 'recovery',
    audit: AuditContext,
  ): Promise<MfaCompletion> {
    await this.throttle.registerSuccess(`mfa:${auth.user.id}`);
    await recordAudit(this.prisma.client, {
      ...audit,
      action: 'mfa.verify',
      entityType: 'user',
      entityId: auth.user.id,
      after: { method },
    });
    return { token: await this.markSessionVerified(auth.sessionId) };
  }

  private markSessionVerified(sessionId: string): Promise<string> {
    return this.sessions.completeMfa(sessionId);
  }

  private async consumeTotp(userId: string, code: string): Promise<boolean> {
    const row = await this.prisma.client.totpSecret.findUnique({ where: { userId } });
    if (!row?.confirmedAt || !/^\d{6}$/.test(code)) return false;
    const step = verifyTotp(this.secrets.decrypt(row.secretEnc), code, {
      lastStep: Number(row.lastStep),
    });
    if (step === null) return false;
    // Só um pedido avança o passo: um código interceptado não pode ser reusado em paralelo.
    const { count } = await this.prisma.client.totpSecret.updateMany({
      where: { userId, lastStep: { lt: BigInt(step) } },
      data: { lastStep: BigInt(step) },
    });
    return count === 1;
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const codeHash = this.secrets.mac(normalizeRecoveryCode(code));
    const { count } = await this.prisma.client.recoveryCode.updateMany({
      where: { userId, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  private async assertNotLocked(userId: string): Promise<void> {
    const lockedFor = await this.throttle.lockedFor(`mfa:${userId}`, `mfa:${userId}`);
    if (lockedFor > 0) throw tooManyRequests(lockedFor);
  }

  private async registerFailure(userId: string): Promise<void> {
    await this.throttle.registerFailure(`mfa:${userId}`, `mfa:${userId}`);
  }

  private async storeChallenge(kind: string, sessionId: string, challenge: string) {
    await this.redis.client.set(
      `webauthn:${kind}:${sessionId}`,
      challenge,
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
  }

  /** Lê e apaga o desafio: cada desafio vale para uma única tentativa. */
  private async takeChallenge(kind: string, sessionId: string): Promise<string> {
    const key = `webauthn:${kind}:${sessionId}`;
    const challenge = await this.redis.client.getdel(key);
    if (!challenge) throw new BadRequestException({ message: 'webauthn_challenge_expired' });
    return challenge;
  }
}
