import { Injectable } from '@nestjs/common';
import { RedisService } from '../infra/redis.service.js';

/** Falhas permitidas antes do bloqueio, por conta e por IP. */
const ACCOUNT_THRESHOLD = 5;
const IP_THRESHOLD = 20;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
/** Por quanto tempo as falhas são lembradas desde a última. */
const FAILURE_WINDOW_MS = 60 * 60_000;

/**
 * Bloqueio progressivo de login: a partir do limite de falhas, cada nova falha
 * dobra o tempo de espera (30 s, 1 min, 2 min… até 15 min). Vale por conta e por IP.
 */
@Injectable()
export class LoginThrottleService {
  constructor(private readonly redis: RedisService) {}

  /** Segundos restantes de bloqueio (0 = liberado). */
  async lockedFor(email: string, ip: string): Promise<number> {
    const ttls = await Promise.all([
      this.redis.client.pttl(this.lockKey('acct', email)),
      this.redis.client.pttl(this.lockKey('ip', ip)),
    ]);
    return Math.ceil(Math.max(0, ...ttls) / 1000);
  }

  async registerFailure(email: string, ip: string): Promise<void> {
    await Promise.all([
      this.bump('acct', email, ACCOUNT_THRESHOLD),
      this.bump('ip', ip, IP_THRESHOLD),
    ]);
  }

  async registerSuccess(email: string): Promise<void> {
    await this.redis.client.del(this.failKey('acct', email), this.lockKey('acct', email));
  }

  private async bump(scope: 'acct' | 'ip', id: string, threshold: number): Promise<void> {
    const failKey = this.failKey(scope, id);
    const count = await this.redis.client.incr(failKey);
    await this.redis.client.pexpire(failKey, FAILURE_WINDOW_MS);
    if (count >= threshold) {
      const lockMs = Math.min(BASE_LOCK_MS * 2 ** (count - threshold), MAX_LOCK_MS);
      await this.redis.client.set(this.lockKey(scope, id), '1', 'PX', lockMs);
    }
  }

  private failKey(scope: string, id: string) {
    return `login:fail:${scope}:${id}`;
  }

  private lockKey(scope: string, id: string) {
    return `login:lock:${scope}:${id}`;
  }
}
