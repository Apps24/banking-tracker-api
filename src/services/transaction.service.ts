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
  if (f.category) where.category = f.category;
  if (f.transactionMode) where.transactionMode = f.transactionMode;
  if (f.startDate || f.endDate) {
    where.smsDate = {};
    if (f.startDate) where.smsDate.gte = new Date(f.startDate);
    if (f.endDate)   where.smsDate.lte = new Date(f.endDate + "T23:59:59.999Z");
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
