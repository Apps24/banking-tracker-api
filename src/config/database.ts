import path from "path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";

// Load .env using an absolute path relative to this file so it works
// regardless of the working directory the server is started from.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Make sure banking-tracker-api/.env exists and contains DATABASE_URL."
  );
}

const adapter = new PrismaNeonHttp(connectionString);

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["query"] : [] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
