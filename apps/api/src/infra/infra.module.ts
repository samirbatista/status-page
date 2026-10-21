import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { NotifyService } from './notify.service.js';
import { RedisService } from './redis.service.js';
import { SecretsService } from './secrets.service.js';

@Global()
@Module({
  providers: [PrismaService, RedisService, SecretsService, NotifyService],
  exports: [PrismaService, RedisService, SecretsService, NotifyService],
})
export class InfraModule {}
