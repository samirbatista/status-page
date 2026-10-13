/**
 * Seed idempotente: cria a conta Dono (local, de emergência) e uma página de exemplo.
 * Uso: DATABASE_URL=... SEED_OWNER_EMAIL=... SEED_OWNER_PASSWORD=... node dist/seed.js
 */
import argon2 from 'argon2';
import { z } from 'zod';
import { createLogger, databaseEnvSchema, loadEnv } from '@status-page/config';
import { createPrismaClient } from './index.js';

const env = loadEnv(
  databaseEnvSchema.extend({
    SEED_OWNER_EMAIL: z.email().transform((email) => email.toLowerCase()),
    SEED_OWNER_PASSWORD: z.string().min(12, 'SEED_OWNER_PASSWORD deve ter ao menos 12 caracteres'),
    SEED_OWNER_NAME: z.string().default('Administrador'),
    SEED_DEMO_PAGE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  }),
);

const log = createLogger('seed');
const prisma = createPrismaClient(env.DATABASE_URL);

async function seedOwner(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: env.SEED_OWNER_EMAIL } });
  if (existing) {
    log.info({ email: env.SEED_OWNER_EMAIL }, 'conta Dono já existe; mantida sem alterações');
    return;
  }

  const passwordHash = await argon2.hash(env.SEED_OWNER_PASSWORD, { type: argon2.argon2id });
  await prisma.user.create({
    data: {
      email: env.SEED_OWNER_EMAIL,
      name: env.SEED_OWNER_NAME,
      isOwner: true,
      isBreakGlass: true,
      identities: {
        create: { provider: 'local', subject: env.SEED_OWNER_EMAIL, passwordHash },
      },
    },
  });
  log.info({ email: env.SEED_OWNER_EMAIL }, 'conta Dono criada');
}

async function seedDemoPage(): Promise<void> {
  if (await prisma.page.findUnique({ where: { slug: 'demo' } })) return;

  const page = await prisma.page.create({
    data: { slug: 'demo', name: 'Status de exemplo', description: 'Página criada pelo seed.' },
  });
  const group = await prisma.componentGroup.create({
    data: { pageId: page.id, name: 'Plataforma', position: 0 },
  });

  const names = ['Site', 'API', 'Banco de dados'];
  for (const [position, name] of names.entries()) {
    await prisma.component.create({
      data: {
        name,
        history: { create: { status: 'operational' } },
        pages: { create: { pageId: page.id, groupId: group.id, position } },
      },
    });
  }
  log.info({ slug: page.slug }, 'página de exemplo criada');
}

try {
  await seedOwner();
  if (env.SEED_DEMO_PAGE) await seedDemoPage();
} finally {
  await prisma.$disconnect();
}
