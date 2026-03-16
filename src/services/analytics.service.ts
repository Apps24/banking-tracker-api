import NodeCache from "node-cache";
import { Prisma, TransactionType } from "@prisma/client";
import { prisma } from "../config/database";

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5-min TTL

function cacheKey(userId: string, fn: string, params: object): string {
  return `${userId}:${fn}:${JSON.stringify(params)}`;
}

// IST offset in ms (UTC+5:30)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toISTDate(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function istDayStart(year: number, month: number, day: number): Date {
  // Returns UTC Date representing midnight IST on given Y/M/D
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
}

function istMonthStart(year: number, month: number): Date {
  return istDayStart(year, month, 1);
}

function istMonthEnd(year: number, month: number): Date {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  return new Date(istMonthStart(nextYear, nextMonth).getTime() - 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getSummary(
  userId: string,
  params: { startDate?: string; endDate?: string; accountId?: string; bankId?: string },
) {
  const key = cacheKey(userId, "summary", params);
  const hit = cache.get<ReturnType<typeof _getSummary>>(key);
  if (hit) return hit;
  const result = await _getSummary(userId, params);
  cache.set(key, result);
  return result;
}

async function _getSummary(
  userId: string,
  { startDate, endDate, accountId, bankId }: { startDate?: string; endDate?: string; accountId?: string; bankId?: string },
) {
  const where: Prisma.TransactionWhereInput = { userId };
  if (accountId) where.accountId = accountId;
  if (bankId) where.bankId = bankId;
  if (startDate || endDate) {
    where.smsDate = {};
    if (startDate) (where.smsDate as Prisma.DateTimeFilter).gte = new Date(startDate);
    if (endDate)   (where.smsDate as Prisma.DateTimeFilter).lte = new Date(endDate + "T23:59:59.999Z");
  }

  const [agg, creditAgg, debitAgg, count] = await Promise.all([
    prisma.transaction.aggregate({ where, _sum: { amount: true }, _avg: { amount: true }, _count: true }),
    prisma.transaction.aggregate({ where: { ...where, type: "CREDIT" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { ...where, type: "DEBIT" },  _sum: { amount: true } }),
    prisma.transaction.count({ where }),
  ]);

  const totalCredit = Number(creditAgg._sum.amount ?? 0);
  const totalDebit  = Number(debitAgg._sum.amount  ?? 0);

  // Top category by debit amount
  const catGroup = await prisma.transaction.groupBy({
    by: ["category"],
    where: { ...where, type: "DEBIT" },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: 1,
  });

  // Top merchant by debit count
  const merchantGroup = await prisma.transaction.groupBy({
    by: ["merchant"],
    where: { ...where, type: "DEBIT", merchant: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });

  return {
    totalInflow: totalCredit,
    totalOutflow: totalDebit,
    netBalance: totalCredit - totalDebit,
    transactionCount: count,
    avgAmount: Number(agg._avg.amount ?? 0),
    topCategory: catGroup[0]?.category ?? null,
    topMerchant: merchantGroup[0]?.merchant ?? null,
  };
}

// ─── Daily ────────────────────────────────────────────────────────────────────

export async function getDailyData(userId: string, year: number, month: number) {
  const key = cacheKey(userId, "daily", { year, month });
  const hit = cache.get<Awaited<ReturnType<typeof _getDailyData>>>(key);
  if (hit) return hit;
  const result = await _getDailyData(userId, year, month);
  cache.set(key, result);
  return result;
}

async function _getDailyData(userId: string, year: number, month: number) {
  const startUTC = istMonthStart(year, month);
  const endUTC   = istMonthEnd(year, month);

  const rows = await prisma.transaction.findMany({
    where: { userId, smsDate: { gte: startUTC, lte: endUTC } },
    select: { smsDate: true, type: true, amount: true },
  });

  const total = daysInMonth(year, month);
  const byDay = new Map<string, { credit: number; debit: number; count: number }>();

  for (const row of rows) {
    const ist  = toISTDate(row.smsDate);
    const dStr = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
    const slot = byDay.get(dStr) ?? { credit: 0, debit: 0, count: 0 };
    const amt  = Number(row.amount);
    if (row.type === "CREDIT") slot.credit += amt; else slot.debit += amt;
    slot.count++;
    byDay.set(dStr, slot);
  }

  const result = [];
  for (let d = 1; d <= total; d++) {
    const dStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const slot = byDay.get(dStr) ?? { credit: 0, debit: 0, count: 0 };
    result.push({ date: dStr, ...slot });
  }
  return result;
}

// ─── Weekly ───────────────────────────────────────────────────────────────────

export async function getWeeklyData(userId: string, year: number) {
  const key = cacheKey(userId, "weekly", { year });
  const hit = cache.get<Awaited<ReturnType<typeof _getWeeklyData>>>(key);
  if (hit) return hit;
  const result = await _getWeeklyData(userId, year);
  cache.set(key, result);
  return result;
}

async function _getWeeklyData(userId: string, year: number) {
  const startUTC = istDayStart(year, 1, 1);
  const endUTC   = new Date(istDayStart(year + 1, 1, 1).getTime() - 1);

  const rows = await prisma.transaction.findMany({
    where: { userId, smsDate: { gte: startUTC, lte: endUTC } },
    select: { smsDate: true, type: true, amount: true },
  });

  // ISO week: get week number 1-52 within the year
  function getWeekNum(d: Date): number {
    const ist = toISTDate(d);
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const dayOfYear = Math.floor((ist.getTime() - jan1.getTime()) / 86400000);
    return Math.min(52, Math.floor(dayOfYear / 7) + 1);
  }

  const byWeek = new Map<number, { credit: number; debit: number }>();
  for (const row of rows) {
    const w    = getWeekNum(row.smsDate);
    const slot = byWeek.get(w) ?? { credit: 0, debit: 0 };
    const amt  = Number(row.amount);
    if (row.type === "CREDIT") slot.credit += amt; else slot.debit += amt;
    byWeek.set(w, slot);
  }

  return Array.from({ length: 52 }, (_, i) => {
    const w     = i + 1;
    const slot  = byWeek.get(w) ?? { credit: 0, debit: 0 };
    const startDay = (w - 1) * 7 + 1;
    const endDay   = Math.min(startDay + 6, 365);
    const weekStart = new Date(Date.UTC(year, 0, startDay));
    const weekEnd   = new Date(Date.UTC(year, 0, endDay));
    return {
      weekNumber: w,
      weekStart: weekStart.toISOString().slice(0, 10),
      weekEnd:   weekEnd.toISOString().slice(0, 10),
      credit: slot.credit,
      debit:  slot.debit,
      net:    slot.credit - slot.debit,
    };
  });
}

// ─── Monthly ──────────────────────────────────────────────────────────────────

export async function getMonthlyData(userId: string, year: number) {
  const key = cacheKey(userId, "monthly", { year });
  const hit = cache.get<Awaited<ReturnType<typeof _getMonthlyData>>>(key);
  if (hit) return hit;
  const result = await _getMonthlyData(userId, year);
  cache.set(key, result);
  return result;
}

async function _getMonthlyData(userId: string, year: number) {
  const startUTC = istDayStart(year, 1, 1);
  const endUTC   = new Date(istDayStart(year + 1, 1, 1).getTime() - 1);

  const rows = await prisma.transaction.findMany({
    where: { userId, smsDate: { gte: startUTC, lte: endUTC } },
    select: { smsDate: true, type: true, amount: true },
  });

  const byMonth = new Map<number, { credit: number; debit: number }>();
  for (const row of rows) {
    const ist = toISTDate(row.smsDate);
    const m   = ist.getUTCMonth() + 1; // 1-12
    const slot = byMonth.get(m) ?? { credit: 0, debit: 0 };
    const amt  = Number(row.amount);
    if (row.type === "CREDIT") slot.credit += amt; else slot.debit += amt;
    byMonth.set(m, slot);
  }

  return Array.from({ length: 12 }, (_, i) => {
    const m    = i + 1;
    const slot = byMonth.get(m) ?? { credit: 0, debit: 0 };
    return {
      month: m,
      monthName: MONTH_NAMES[i],
      credit: slot.credit,
      debit:  slot.debit,
      net:    slot.credit - slot.debit,
    };
  });
}

// ─── Category Breakdown ───────────────────────────────────────────────────────

export async function getCategoryBreakdown(
  userId: string,
  params: { startDate?: string; endDate?: string; type?: TransactionType },
) {
  const key = cacheKey(userId, "category", params);
  const hit = cache.get<Awaited<ReturnType<typeof _getCategoryBreakdown>>>(key);
  if (hit) return hit;
  const result = await _getCategoryBreakdown(userId, params);
  cache.set(key, result);
  return result;
}

async function _getCategoryBreakdown(
  userId: string,
  { startDate, endDate, type }: { startDate?: string; endDate?: string; type?: TransactionType },
) {
  const where: Prisma.TransactionWhereInput = { userId };
  if (type) where.type = type;
  if (startDate || endDate) {
    where.smsDate = {};
    if (startDate) (where.smsDate as Prisma.DateTimeFilter).gte = new Date(startDate);
    if (endDate)   (where.smsDate as Prisma.DateTimeFilter).lte = new Date(endDate + "T23:59:59.999Z");
  }

  const groups = await prisma.transaction.groupBy({
    by: ["category"],
    where,
    _sum:   { amount: true },
    _count: { id: true },
    orderBy: { _sum: { amount: "desc" } },
  });

  const grandTotal = groups.reduce((s, g) => s + Number(g._sum.amount ?? 0), 0);

  return groups.map((g) => ({
    category:   g.category,
    amount:     Number(g._sum.amount ?? 0),
    count:      g._count.id,
    percentage: grandTotal > 0 ? Math.round((Number(g._sum.amount ?? 0) / grandTotal) * 10000) / 100 : 0,
  }));
}

// ─── Bank Breakdown ───────────────────────────────────────────────────────────

export async function getBankBreakdown(
  userId: string,
  params: { startDate?: string; endDate?: string },
) {
  const key = cacheKey(userId, "bank", params);
  const hit = cache.get<Awaited<ReturnType<typeof _getBankBreakdown>>>(key);
  if (hit) return hit;
  const result = await _getBankBreakdown(userId, params);
  cache.set(key, result);
  return result;
}

async function _getBankBreakdown(
  userId: string,
  { startDate, endDate }: { startDate?: string; endDate?: string },
) {
  const where: Prisma.TransactionWhereInput = { userId };
  if (startDate || endDate) {
    where.smsDate = {};
    if (startDate) (where.smsDate as Prisma.DateTimeFilter).gte = new Date(startDate);
    if (endDate)   (where.smsDate as Prisma.DateTimeFilter).lte = new Date(endDate + "T23:59:59.999Z");
  }

  // Get all transactions with bankId + type + amount
  const rows = await prisma.transaction.findMany({
    where,
    select: { bankId: true, type: true, amount: true },
  });

  const banks = await prisma.bank.findMany({ where: { userId } });
  const bankMap = new Map(banks.map((b) => [b.id, b]));

  const byBank = new Map<string, { credit: number; debit: number; count: number }>();
  for (const row of rows) {
    const slot = byBank.get(row.bankId) ?? { credit: 0, debit: 0, count: 0 };
    const amt  = Number(row.amount);
    if (row.type === "CREDIT") slot.credit += amt; else slot.debit += amt;
    slot.count++;
    byBank.set(row.bankId, slot);
  }

  return Array.from(byBank.entries())
    .map(([bankId, slot]) => {
      const b = bankMap.get(bankId);
      return {
        bankId,
        bank:      b?.name  ?? "Unknown",
        bankColor: b?.color ?? "#888",
        total:  slot.credit + slot.debit,
        credit: slot.credit,
        debit:  slot.debit,
        net:    slot.credit - slot.debit,
        count:  slot.count,
      };
    })
    .sort((a, b) => b.total - a.total);
}

// ─── Trends ───────────────────────────────────────────────────────────────────

export async function getTrends(userId: string, period: "7d" | "30d" | "90d" | "1y") {
  const key = cacheKey(userId, "trends", { period });
  const hit = cache.get<Awaited<ReturnType<typeof _getTrends>>>(key);
  if (hit) return hit;
  const result = await _getTrends(userId, period);
  cache.set(key, result);
  return result;
}

async function _getTrends(userId: string, period: "7d" | "30d" | "90d" | "1y") {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
  const now  = new Date();
  const currentStart = new Date(now.getTime() - days * 86400000);
  const previousStart = new Date(currentStart.getTime() - days * 86400000);

  async function periodTotals(start: Date, end: Date) {
    const [creditAgg, debitAgg] = await Promise.all([
      prisma.transaction.aggregate({ where: { userId, type: "CREDIT", smsDate: { gte: start, lte: end } }, _sum: { amount: true }, _count: true }),
      prisma.transaction.aggregate({ where: { userId, type: "DEBIT",  smsDate: { gte: start, lte: end } }, _sum: { amount: true }, _count: true }),
    ]);
    const credit = Number(creditAgg._sum.amount ?? 0);
    const debit  = Number(debitAgg._sum.amount  ?? 0);
    return { credit, debit, net: credit - debit, count: creditAgg._count + debitAgg._count };
  }

  const [current, previous] = await Promise.all([
    periodTotals(currentStart, now),
    periodTotals(previousStart, currentStart),
  ]);

  function changePercent(curr: number, prev: number): number | null {
    if (prev === 0) return null;
    return Math.round(((curr - prev) / prev) * 10000) / 100;
  }

  return {
    period,
    current,
    previous,
    changes: {
      credit:  changePercent(current.credit, previous.credit),
      debit:   changePercent(current.debit,  previous.debit),
      net:     changePercent(current.net,    previous.net),
      count:   changePercent(current.count,  previous.count),
    },
  };
}
