import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { listAccounts, updateAccount } from "../controllers/bank.controller";

const router = Router();

router.use(requireAuth);

router.get("/",       listAccounts);
router.patch("/:id",  updateAccount);

export default router;
