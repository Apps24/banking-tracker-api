import type { Request, Response, NextFunction } from "express";
import { responseHelper } from "../utils/responseHelper";
import {
  getSummary, getDailyData, getWeeklyData, getMonthlyData,
  getCategoryBreakdown, getBankBreakdown, getTrends,
} from "../services/analytics.service";
import { TransactionType } from "@prisma/client";

export const summary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query as Record<string, string>;
    const data = await getSummary(req.userId, {
      startDate: q.startDate,
      endDate:   q.endDate,
      accountId: q.accountId,
      bankId:    q.bankId,
    });
    responseHelper.success(res, data);
  } catch (err) { next(err); }
};

export const daily = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now   = new Date();
    const year  = parseInt(String(req.query.year  ?? now.getFullYear()));
    const month = parseInt(String(req.query.month ?? now.getMonth() + 1));
    const data  = await getDailyData(req.userId, year, month);
    responseHelper.success(res, data);
  } catch (err) { next(err); }
};

export const weekly = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(String(req.query.year ?? new Date().getFullYear()));
    const data = await getWeeklyData(req.userId, year);
    responseHelper.success(res, data);
  } catch (err) { next(err); }
};

export const monthly = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(String(req.query.year ?? new Date().getFullYear()));
    const data = await getMonthlyData(req.userId, year);
    responseHelper.success(res, data);
  } catch (err) { next(err); }
};

export const byCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q    = req.query as Record<string, string>;
    const data = await getCategoryBreakdown(req.userId, {
      startDate: q.startDate,
      endDate:   q.endDate,
      type:      q.type as TransactionType | undefined,
    });
    responseHelper.success(res, data);
  } catch (err) { next(err); }
};

export const byBank = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q    = req.query as Record<string, string>;
    const data = await getBankBreakdown(req.userId, { startDate: q.startDate, endDate: q.endDate });
    responseHelper.success(res, data);
  } catch (err) { next(err); }
};

export const trends = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = (req.query.period as "7d" | "30d" | "90d" | "1y") ?? "30d";
    const data   = await getTrends(req.userId, period);
    responseHelper.success(res, data);
  } catch (err) { next(err); }
};
