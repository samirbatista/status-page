import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '@status-page/db';
import { testDatabaseUrl } from './env.js';

/** Cria o banco de testes (se preciso) e aplica as migrações antes da suíte. */
export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const database = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const prisma = createPrismaClient(admin.toString());
  try {
    const exists = await prisma.$queryRaw<
      unknown[]
    >`SELECT 1 FROM pg_database WHERE datname = ${database}`;
    if (exists.length === 0) await prisma.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  } finally {
    await prisma.$disconnect();
  }

  const dbPackage = fileURLToPath(new URL('../../../../packages/db', import.meta.url));
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'ignore',
  });
}
