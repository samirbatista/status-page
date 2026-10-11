import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../env.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    // lazyConnect: a API sobe mesmo com o Redis indisponível; o /readyz reporta o problema.
    this.client = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    // Sem este listener o ioredis trata falhas de conexão como erro não tratado.
    this.client.on('error', () => undefined);
  }

  async ping(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
