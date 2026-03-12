import { Router } from "express";
import authRoutes from "./auth.routes";
import transactionRoutes from "./transaction.routes";
import analyticsRoutes from "./analytics.routes";
import bankRoutes from "./bank.routes";
import accountRoutes from "./account.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/transactions", transactionRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/banks", bankRoutes);
router.use("/accounts", accountRoutes);

export default router;
