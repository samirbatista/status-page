import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';

type CheckResult = 'ok' | 'error';

@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: o processo está de pé. */
  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependências (PostgreSQL e Redis) acessíveis. */
  @Get('readyz')
  async readyz(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: CheckResult; checks: Record<string, CheckResult> }> {
    const [database, redis] = await Promise.all([
      this.check(() => this.prisma.ping()),
      this.check(() => this.redis.ping()),
    ]);
    const checks = { database, redis };
    const status = Object.values(checks).every((c) => c === 'ok') ? 'ok' : 'error';
    res.status(status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status, checks };
  }

  private async check(fn: () => Promise<void>): Promise<CheckResult> {
    try {
      await fn();
      return 'ok';
    } catch {
      return 'error';
    }
  }
}
