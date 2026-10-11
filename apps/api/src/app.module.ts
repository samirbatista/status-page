import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerOptions } from '@status-page/config';
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
        HealthModule,
      ],
      providers: [{ provide: API_ENV, useValue: env }],
      exports: [API_ENV],
    };
  }
}
