import "dotenv/config";
import app from "./app";
import { logger } from "./config/logger";
import { prisma } from "./config/database";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
  logger.info(`Auth: Better Auth self-hosted at /api/auth (${process.env.BETTER_AUTH_URL})`);
  logger.info("Database: Neon serverless (Prisma)");
});

// Graceful shutdown
async function shutdown() {
  logger.info("Shutdown signal received, closing server...");
  server.close(async () => {
    await prisma.$disconnect();
    logger.info("Server closed.");
    process.exit(0);
  });
  setTimeout(() => { logger.error("Forced shutdown after timeout"); process.exit(1); }, 30_000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
