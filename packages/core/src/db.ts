import { type Prisma, type PrismaClient } from '@status-page/db';

/** Aceita tanto o client quanto um client de transação (`prisma.$transaction`). */
export type Db = PrismaClient | Prisma.TransactionClient;
