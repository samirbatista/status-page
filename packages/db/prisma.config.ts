import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Em desenvolvimento as variáveis ficam no .env da raiz do monorepo.
// Variáveis já definidas no ambiente (ex.: no container) têm prioridade.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // `prisma generate` não precisa de banco; só migrate/seed exigem DATABASE_URL.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
