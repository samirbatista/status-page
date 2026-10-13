import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../infra/redis.service.js';

export interface RateLimitResult {
  allowed: boolean;
  /** Segundos até a janela reiniciar. */
  retryAfter: number;
}

/** Limite de requisições por janela fixa, com contadores no Redis. */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `ratelimit:${key}`;
    const [[, count], [, ttl]] = (await this.redis.client
      .multi()
      .incr(redisKey)
      .pttl(redisKey)
      .exec()) as [[null, number], [null, number]];
    if (ttl < 0) await this.redis.client.pexpire(redisKey, windowSeconds * 1000);
    const retryAfter = Math.ceil((ttl < 0 ? windowSeconds * 1000 : ttl) / 1000);
    return { allowed: count <= limit, retryAfter };
  }

  /** Lança 429 com `Retry-After` quando o limite é excedido. */
  async enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
    const result = await this.hit(key, limit, windowSeconds);
    if (!result.allowed) throw tooManyRequests(result.retryAfter);
  }
}

export function tooManyRequests(retryAfter: number): HttpException {
  return new HttpException(
    { message: 'too_many_requests', retryAfter },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
