import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { type ApiEnv } from './env.js';

export async function createApp(env: ApiEnv): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(env), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // Atrás do Caddy: confia no primeiro proxy para obter o IP real do cliente.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  return app;
}
