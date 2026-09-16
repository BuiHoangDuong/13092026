import { PrismaClient } from "../dist/generated/client/index.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
export * from "../dist/generated/client/index.js";
