import "dotenv/config";
import "./config/env"; // validate env vars on startup
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import { v4 as uuidv4 } from "uuid";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";
import { logger } from "./config/logger";
import { prisma } from "./config/database";
import { apiLimiter, authLimiter } from "./middlewares/rateLimit.middleware";
import { globalErrorHandler } from "./middlewares/error.middleware";
import v1Router from "./routes/index";

const app = express();
const isProd = process.env.NODE_ENV === "production";

// Better Auth handler (must be before body parsers)
app.use("/api/auth", authLimiter);
app.all("/api/auth/{*action}", toNodeHandler(auth));

// Security & utility middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? [],
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  maxAge: 3600,
}));
app.use(compression() as express.RequestHandler);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(isProd ? "combined" : "dev", { stream: { write: (msg) => logger.http(msg.trim()) } }));

// Request ID
app.use((req: Request, res: Response, next: NextFunction) => {
  req.requestId = uuidv4();
  res.setHeader("X-Request-Id", req.requestId);
  next();
});

// API routes
app.use("/api/v1", apiLimiter);
app.use("/api/v1", v1Router);

// Health check with DB connectivity test
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      uptime: process.uptime(),
    });
  } catch {
    res.status(503).json({ status: "unhealthy", reason: "database_unavailable" });
  }
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

// Global error handler
app.use(globalErrorHandler);

export default app;
