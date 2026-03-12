import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { summary, daily, weekly, monthly, byCategory, byBank, trends } from "../controllers/analytics.controller";

const router = Router();

router.use(requireAuth);

router.get("/summary",      summary);
router.get("/daily",        daily);
router.get("/weekly",       weekly);
router.get("/monthly",      monthly);
router.get("/by-category",  byCategory);
router.get("/by-bank",      byBank);
router.get("/trends",       trends);

export default router;
