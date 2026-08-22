import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Either the pooled client or a transaction-scoped one. Repositories accept
 * this so the same class serves both a plain read and a unit of work.
 */
export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export { prisma };
