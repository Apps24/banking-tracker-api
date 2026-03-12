import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { list, getOne, update, remove, processSms, processBatch } from "../controllers/transaction.controller";

const router = Router();

router.use(requireAuth);

router.get("/",              list);
router.get("/:id",           getOne);
router.patch("/:id",         update);
router.delete("/:id",        remove);
router.post("/sms/process",  processSms);
router.post("/sms/batch",    processBatch);

export default router;
