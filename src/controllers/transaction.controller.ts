import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { responseHelper } from "../utils/responseHelper";
import {
  getTransactions, getTransaction, createTransaction, updateTransaction,
  deleteTransaction, processSingleSms, processBatchSms,
} from "../services/transaction.service";
import type { TransactionFilters } from "../services/transaction.service";
import { TransactionType, TransactionCategory, TransactionMode } from "@prisma/client";

// ── Validation schemas ─────────────────────────────────────────────────────────

const createTransactionSchema = z.object({
  type:            z.enum(["CREDIT", "DEBIT"]),
  amount:          z.number().positive(),
  bankId:          z.string().min(1),
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  description:     z.string().max(500).optional(),
  merchant:        z.string().max(200).optional(),
  category:        z.nativeEnum(TransactionCategory),
  transactionMode: z.nativeEnum(TransactionMode).optional(),
});

const smsSchema = z.object({
  sender:     z.string().min(1).max(50),
  body:       z.string().min(1).max(2000),
  receivedAt: z.string().datetime({ message: "Must be ISO-8601 datetime" }).optional(),
});

const batchSmsSchema = z.object({
  messages: z.array(smsSchema).min(1).max(500),
});

// ── Controllers ───────────────────────────────────────────────────────────────

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createTransactionSchema.parse(req.body);
    const tx = await createTransaction(req.userId, data);
    responseHelper.success(res, tx, "Transaction created", 201);
  } catch (err) { next(err); }
};

export const list = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query as Record<string, string>;
    // Support shorthand sort param: "date_desc" → sortBy=smsDate, sortOrder=desc
    let sortBy  = q.sortBy  as TransactionFilters["sortBy"];
    let sortOrder = q.sortOrder as "asc" | "desc" | undefined;
    if (q.sort) {
      const [field, order] = q.sort.split("_");
      sortBy    = (field === "date" ? "smsDate" : field === "amount" ? "amount" : "smsDate") as TransactionFilters["sortBy"];
      sortOrder = (order === "asc" ? "asc" : "desc");
    }

    const filters: TransactionFilters = {
      page:   q.page   ? parseInt(q.page)  : undefined,
      limit:  q.limit  ? parseInt(q.limit) : undefined,
      startDate: q.startDate,
      endDate:   q.endDate,
      type:   q.type   as TransactionType | undefined,
      bankId: q.bankId,
      accountId: q.accountId,
      category:   q.category   as TransactionCategory | undefined,
      categories: q.categories,
      transactionMode: q.transactionMode as TransactionMode | undefined,
      search:    q.search,
      sortBy,
      sortOrder,
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
