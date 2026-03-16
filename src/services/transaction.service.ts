import { Prisma, TransactionType, TransactionCategory, TransactionMode } from "@prisma/client";
import { prisma } from "../config/database";
import { AppError } from "../middlewares/error.middleware";
import { batchProcessSms, processRawSms, type RawSmsInput } from "./sms.service";

// ─── Query params type ────────────────────────────────────────────────────────

export type TransactionFilters = {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  type?: TransactionType;
  bankId?: string;
  accountId?: string;
  category?: TransactionCategory;
  categories?: string;          // comma-separated, e.g. "FOOD,SHOPPING"
  transactionMode?: TransactionMode;
  search?: string;
  sortBy?: "smsDate" | "amount" | "createdAt";
  sortOrder?: "asc" | "desc";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWhere(userId: string, f: TransactionFilters): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { userId };
  if (f.type) where.type = f.type;
  if (f.bankId) where.bankId = f.bankId;
  if (f.accountId) where.accountId = f.accountId;

  // Single category OR multi-category (comma-separated)
  if (f.categories) {
    const cats = f.categories.split(",").map((c) => c.trim()).filter(Boolean) as TransactionCategory[];
    if (cats.length === 1) where.category = cats[0];
    else if (cats.length > 1) where.category = { in: cats };
  } else if (f.category) {
    where.category = f.category;
  }

  if (f.transactionMode) where.transactionMode = f.transactionMode;
  if (f.startDate || f.endDate) {
    where.smsDate = {};
    // Use start of day and end of day in IST (+05:30) to avoid timezone boundary issues
    if (f.startDate) where.smsDate.gte = new Date(f.startDate + "T00:00:00.000+05:30");
    if (f.endDate)   where.smsDate.lte = new Date(f.endDate   + "T23:59:59.999+05:30");
  }
  if (f.search) {
    const q = f.search.trim();
    where.OR = [
      { description:    { contains: q, mode: "insensitive" } },
      { merchant:       { contains: q, mode: "insensitive" } },
      { toIdentifier:   { contains: q, mode: "insensitive" } },
      { fromIdentifier: { contains: q, mode: "insensitive" } },
      { reference:      { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function getTransactions(userId: string, f: TransactionFilters) {
  const page  = Math.max(1, f.page  ?? 1);
  const limit = Math.min(100, Math.max(1, f.limit ?? 20));
  const skip  = (page - 1) * limit;
  const orderBy = { [f.sortBy ?? "smsDate"]: f.sortOrder ?? "desc" } as const;

  const where = buildWhere(userId, f);
  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        bank: { select: { id: true, name: true, shortCode: true, color: true, logoUrl: true } },
        account: { select: { id: true, accountNumber: true, accountType: true, nickname: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);
  return { transactions, total, page, limit };
}

export async function getTransaction(userId: string, id: string) {
  const tx = await prisma.transaction.findFirst({
    where: { id, userId },
    include: {
      bank:    { select: { id: true, name: true, shortCode: true, color: true } },
      account: { select: { id: true, accountNumber: true, accountType: true, nickname: true } },
      smsLog:  { select: { id: true, sender: true, receivedAt: true } },
    },
  });
  if (!tx) throw new AppError("Transaction not found", 404);
  return tx;
}

export async function updateTransaction(
  userId: string,
  id: string,
  data: { category?: TransactionCategory; merchant?: string; toIdentifier?: string; description?: string },
) {
  const existing = await prisma.transaction.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError("Transaction not found", 404);
  return prisma.transaction.update({
    where: { id, userId },
    data: {
      ...(data.category    !== undefined && { category: data.category }),
      ...(data.merchant    !== undefined && { merchant: data.merchant }),
      ...(data.toIdentifier !== undefined && { toIdentifier: data.toIdentifier }),
      ...(data.description !== undefined && { description: data.description }),
    },
  });
}

export async function deleteTransaction(userId: string, id: string) {
  const existing = await prisma.transaction.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError("Transaction not found", 404);
  await prisma.transaction.delete({ where: { id } });
}

export type CreateTransactionInput = {
  type: TransactionType;
  amount: number;
  bankId: string;
  date: string;           // ISO date string "YYYY-MM-DD"
  description?: string;
  merchant?: string;
  category: TransactionCategory;
  transactionMode?: TransactionMode;
  currency?: string;
};

export async function createTransaction(userId: string, input: CreateTransactionInput) {
  const { type, amount, bankId, date, description, merchant, category, transactionMode, currency } = input;

  // Verify bank belongs to this user
  const bank = await prisma.bank.findFirst({ where: { id: bankId, userId } });
  if (!bank) throw new AppError("Bank not found", 404);

  // Find first active account for this bank, or create a default one
  let account = await prisma.bankAccount.findFirst({ where: { userId, bankId, isActive: true } });
  if (!account) {
    account = await prisma.bankAccount.create({
      data: { userId, bankId, accountNumber: "0000", accountType: "SAVINGS", currency: currency ?? "INR" },
    });
  }

  const txDate = new Date(date + "T12:00:00.000+05:30");
  const desc = description?.trim() ||
    (type === "CREDIT" ? "Manual credit entry" : `Payment to ${merchant ?? "unknown"}`);

  return prisma.transaction.create({
    data: {
      userId,
      accountId: account.id,
      bankId,
      type,
      amount,
      currency: currency ?? "INR",
      description: desc,
      merchant: merchant?.trim() || null,
      transactionMode: transactionMode ?? "OTHER",
      category,
      smsDate: txDate,
      rawSms: "",
    },
    include: {
      bank:    { select: { id: true, name: true, shortCode: true, color: true } },
      account: { select: { id: true, accountNumber: true, accountType: true } },
    },
  });
}

export async function processSingleSms(
  userId: string,
  sender: string,
  body: string,
  receivedAt: Date,
) {
  return processRawSms(userId, sender, body, receivedAt);
}

export async function processBatchSms(userId: string, messages: RawSmsInput[]) {
  if (messages.length > 500) throw new AppError("Maximum 500 messages per batch", 400);
  return batchProcessSms(userId, messages);
}
