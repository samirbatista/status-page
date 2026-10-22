import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { type ApiEnv } from './env.js';
import { setupApiDocs } from './openapi.js';
import { APP_VERSION } from './version.js';

export async function createApp(env: ApiEnv): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
    // Corpo bruto para conferir a assinatura HMAC dos webhooks de entrada.
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  // Alertmanager e Grafana podem mandar lotes grandes de alertas.
  app.useBodyParser('json', { limit: '1mb' });
  app.use(cookieParser());
  app.enableShutdownHooks();
  setupApiDocs(app, APP_VERSION);
  // Atrás do Caddy: confia no primeiro proxy para obter o IP real do cliente.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  return app;
}
