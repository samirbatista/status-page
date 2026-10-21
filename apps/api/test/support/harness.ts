import { type INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import { Redis } from 'ioredis';
import request from 'supertest';
import { createPrismaClient, type PrismaClient } from '@status-page/db';
import { type Role } from '@status-page/shared';
import { createApp } from '../../src/app.js';
import { testEnv } from './env.js';

export interface Harness {
  app: INestApplication;
  prisma: PrismaClient;
  redis: Redis;
  /** Cliente HTTP anônimo. */
  anon: Client;
  close(): Promise<void>;
}

export type Client = ReturnType<typeof client>;

/** Wrapper do supertest que envia o cabeçalho anti-CSRF nas mutações e mantém cookies. */
export function client(app: INestApplication, agent = request.agent(app.getHttpServer())) {
  const csrf = { 'X-Requested-With': 'status-page' };
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set(csrf).send(body),
    put: (url: string, body?: object) => agent.put(url).set(csrf).send(body),
    patch: (url: string, body?: object) => agent.patch(url).set(csrf).send(body),
    delete: (url: string) => agent.delete(url).set(csrf),
  };
}

export async function createHarness(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<Harness> {
  const env = testEnv(overrides);
  const app = await createApp(env);
  await app.init();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL);
  await resetState(prisma, redis);
  return {
    app,
    prisma,
    redis,
    anon: client(app),
    async close() {
      await app.close();
      await prisma.$disconnect();
      redis.disconnect();
    },
  };
}

export async function resetState(prisma: PrismaClient, redis: Redis): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  }
  await redis.flushdb();
}

export const PASSWORD = 'senha-de-teste-bem-longa';

export async function createUser(
  prisma: PrismaClient,
  data: {
    email: string;
    name?: string;
    isOwner?: boolean;
    roles?: Record<string, Exclude<Role, 'owner'>>;
  },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email.split('@')[0]!,
      isOwner: data.isOwner ?? false,
      identities: {
        create: {
          provider: 'local',
          subject: data.email,
          passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        },
      },
      pageRoles: {
        create: Object.entries(data.roles ?? {}).map(([pageId, role]) => ({ pageId, role })),
      },
    },
  });
}

export async function loginAs(h: Harness, email: string, password = PASSWORD): Promise<Client> {
  const c = client(h.app);
  const res = await c.post('/api/auth/login', { email, password });
  if (res.status !== 200)
    throw new Error(`login falhou (${res.status}): ${JSON.stringify(res.body)}`);
  return c;
}
