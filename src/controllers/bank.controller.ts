import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/database";
import { responseHelper } from "../utils/responseHelper";
import { AppError } from "../middlewares/error.middleware";

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
    const { name, shortCode, smsPattern, color, logoUrl } = req.body as {
      name: string; shortCode: string; smsPattern: string; color: string; logoUrl?: string;
    };
    const bank = await prisma.bank.create({
      data: { userId: req.userId, name, shortCode: shortCode.toUpperCase(), smsPattern, color, logoUrl },
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

    const { nickname, isActive } = req.body as { nickname?: string; isActive?: boolean };
    const updated = await prisma.bankAccount.update({
      where: { id },
      data: {
        ...(nickname  !== undefined && { nickname }),
        ...(isActive  !== undefined && { isActive }),
      },
    });
    responseHelper.success(res, updated, "Account updated");
  } catch (err) { next(err); }
};
