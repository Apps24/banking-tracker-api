import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { responseHelper } from "../utils/responseHelper";
import {
  getTransactions, getTransaction, updateTransaction,
  deleteTransaction, processSingleSms, processBatchSms,
} from "../services/transaction.service";
import type { TransactionFilters } from "../services/transaction.service";
import { TransactionType, TransactionCategory, TransactionMode } from "@prisma/client";

// ── Validation schemas ─────────────────────────────────────────────────────────

const smsSchema = z.object({
  sender:     z.string().min(1).max(50),
  body:       z.string().min(1).max(2000),
  receivedAt: z.string().datetime({ message: "Must be ISO-8601 datetime" }).optional(),
});

const batchSmsSchema = z.object({
  messages: z.array(smsSchema).min(1).max(500),
});

// ── Controllers ───────────────────────────────────────────────────────────────

export const list = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query as Record<string, string>;
    const filters: TransactionFilters = {
      page:   q.page   ? parseInt(q.page)  : undefined,
      limit:  q.limit  ? parseInt(q.limit) : undefined,
      startDate: q.startDate,
      endDate:   q.endDate,
      type:   q.type   as TransactionType | undefined,
      bankId: q.bankId,
      accountId: q.accountId,
      category: q.category as TransactionCategory | undefined,
      transactionMode: q.transactionMode as TransactionMode | undefined,
      search:    q.search,
      sortBy:    q.sortBy as TransactionFilters["sortBy"],
      sortOrder: q.sortOrder as "asc" | "desc" | undefined,
    };
    const { transactions, total, page, limit } = await getTransactions(req.userId, filters);
    responseHelper.paginated(res, transactions, { page, limit, total });
  } catch (err) { next(err); }
};

export const getOne = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tx = await getTransaction(req.userId, String(req.params.id));
    responseHelper.success(res, tx);
  } catch (err) { next(err); }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tx = await updateTransaction(req.userId, String(req.params.id), req.body);
    responseHelper.success(res, tx, "Transaction updated");
  } catch (err) { next(err); }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteTransaction(req.userId, String(req.params.id));
    responseHelper.success(res, null, "Transaction deleted");
  } catch (err) { next(err); }
};

export const processSms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sender, body, receivedAt } = smsSchema.parse(req.body);
    const tx = await processSingleSms(req.userId, sender, body, receivedAt ? new Date(receivedAt) : new Date());
    if (!tx) {
      responseHelper.success(res, null, "SMS received but could not be parsed as a transaction");
      return;
    }
    responseHelper.success(res, tx, "SMS processed", 201);
  } catch (err) { next(err); }
};

export const processBatch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messages } = batchSmsSchema.parse(req.body);
    const normalized = messages.map((m) => ({
      sender: m.sender,
      body: m.body,
      receivedAt: m.receivedAt ? new Date(m.receivedAt) : new Date(),
    }));
    const stats = await processBatchSms(req.userId, normalized);
    responseHelper.success(res, stats, "Batch SMS processed");
  } catch (err) { next(err); }
};
