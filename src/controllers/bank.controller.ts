import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { responseHelper } from "../utils/responseHelper";
import { AppError } from "../middlewares/error.middleware";

// ── Validation schemas ─────────────────────────────────────────────────────────

const createBankSchema = z.object({
  name:       z.string().min(1).max(100),
  shortCode:  z.string().min(2).max(10).regex(/^[A-Za-z0-9]+$/, "Letters and numbers only"),
  smsPattern: z.string().min(1).max(500).refine((p) => {
    try { new RegExp(p, "i"); return true; } catch { return false; }
  }, "Invalid regular expression"),
  color:   z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a hex colour e.g. #FF5733"),
  logoUrl: z.string().url().max(2048).optional().or(z.literal("")),
});

const updateAccountSchema = z.object({
  nickname: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

// ── Controllers ───────────────────────────────────────────────────────────────

export const listBanks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const banks = await prisma.bank.findMany({
      where: { userId: req.userId },
      include: { _count: { select: { accounts: true, transactions: true } } },
      orderBy: { name: "asc" },
    });
    responseHelper.success(res, banks);
  } catch (err) { next(err); }
};

export const createBank = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, shortCode, smsPattern, color, logoUrl } = createBankSchema.parse(req.body);
    const bank = await prisma.bank.create({
      data: {
        userId: req.userId,
        name,
        shortCode: shortCode.toUpperCase(),
        smsPattern,
        color,
        ...(logoUrl ? { logoUrl } : {}),
      },
    });
    responseHelper.success(res, bank, "Bank created", 201);
  } catch (err) { next(err); }
};

export const getBankAccounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const bank = await prisma.bank.findFirst({ where: { id, userId: req.userId } });
    if (!bank) throw new AppError("Bank not found", 404);

    const accounts = await prisma.bankAccount.findMany({
      where: { bankId: id, userId: req.userId },
      orderBy: { createdAt: "asc" },
    });
    responseHelper.success(res, accounts);
  } catch (err) { next(err); }
};

export const listAccounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { userId: req.userId },
      include: { bank: { select: { id: true, name: true, shortCode: true, color: true, logoUrl: true } } },
      orderBy: { createdAt: "asc" },
    });
    responseHelper.success(res, accounts);
  } catch (err) { next(err); }
};

export const updateAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const acct = await prisma.bankAccount.findFirst({ where: { id, userId: req.userId } });
    if (!acct) throw new AppError("Account not found", 404);

    const { nickname, isActive } = updateAccountSchema.parse(req.body);
    const updated = await prisma.bankAccount.update({
      where: { id, userId: req.userId },
      data: {
        ...(nickname  !== undefined && { nickname }),
        ...(isActive  !== undefined && { isActive }),
      },
    });
    responseHelper.success(res, updated, "Account updated");
  } catch (err) { next(err); }
};
