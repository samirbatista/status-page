import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loggerOptions } from '@status-page/config';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { CsrfGuard } from './common/csrf.guard.js';
import { RetryAfterFilter } from './common/retry-after.filter.js';
import { DomainModule } from './domain.module.js';
import { API_ENV, type ApiEnv } from './env.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...loggerOptions('api', env.LOG_LEVEL),
            // Health checks são chamados a cada poucos segundos; não poluem o log.
            autoLogging: { ignore: (req) => /\/(healthz|readyz)$/.test(req.url ?? '') },
          },
        }),
        InfraModule,
        AuthModule,
        HealthModule,
        DomainModule,
      ],
      providers: [
        { provide: API_ENV, useValue: env },
        // Ordem importa: CSRF antes da autenticação.
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: RetryAfterFilter },
      ],
      exports: [API_ENV],
    };
  }
}
