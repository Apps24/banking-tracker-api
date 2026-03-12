import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { listBanks, createBank, getBankAccounts, listAccounts, updateAccount } from "../controllers/bank.controller";

const router = Router();

router.use(requireAuth);

router.get("/",                  listBanks);
router.post("/",                 createBank);
router.get("/:id/accounts",     getBankAccounts);
router.get("/accounts",         listAccounts);
router.patch("/accounts/:id",   updateAccount);

export default router;
