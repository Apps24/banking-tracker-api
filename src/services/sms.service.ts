import { AccountType } from "@prisma/client";
import { prisma } from "../config/database";
import { parseSms } from "../utils/smsParser";
import { logger } from "../config/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RawSmsInput = {
  sender: string;
  body: string;
  receivedAt: Date;
};

export type BatchStats = {
  total: number;
  parsed: number;
  skipped: number;
  failed: number;
};

// ─── processRawSms ────────────────────────────────────────────────────────────

export async function processRawSms(
  userId: string,
  sender: string,
  body: string,
  receivedAt: Date,
) {
  logger.info("━━━ [SMS PIPELINE START] ━━━", { sender, bodyPreview: body.slice(0, 80) });

  // 0. Exact-duplicate check — same user + sender + body already in SmsLog
  const existingLog = await prisma.smsLog.findFirst({
    where: { userId, sender, body },
    select: { id: true, parsedTransactionId: true },
  });
  if (existingLog) {
    logger.info("[STEP 0] ⏭  SKIPPED — exact duplicate SMS already in SmsLog", { existingLogId: existingLog.id });
    return null;
  }

  // 1. Create SmsLog record
  const smsLog = await prisma.smsLog.create({
    data: { userId, sender, body, receivedAt },
  });
  logger.info("[STEP 1] SmsLog created", { smsLogId: smsLog.id });

  // 2. Parse SMS
  const parsed = parseSms(sender, body);
  logger.info("[STEP 2] parseSms result", {
    matched: !!parsed,
    type: parsed?.type,
    amount: parsed?.amount,
    currency: parsed?.currency,
    bankShortCode: parsed?.bankShortCode,
    transactionMode: parsed?.transactionMode,
    isBillDue: parsed?.isBillDue,
  });

  if (!parsed) {
    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { parseError: "NO_PATTERN_MATCHED" },
    });
    logger.warn("[STEP 2] ❌ STOPPED — no regex pattern matched", { sender, body });
    return null;
  }

  // 3. Skip bill due reminders
  if (parsed.isBillDue) {
    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { parseError: "BILL_DUE_SKIPPED" },
    });
    logger.info("[STEP 3] ⏭  SKIPPED — bill due reminder, not a transaction");
    return null;
  }

  // 4. Find matching bank for this user by testing sender against smsPattern
  const banks = await prisma.bank.findMany({ where: { userId, isActive: true } });
  logger.info("[STEP 4] Banks in DB for user", {
    count: banks.length,
    banks: banks.map((b) => ({ name: b.name, shortCode: b.shortCode, smsPattern: b.smsPattern })),
  });

  let matchedBank = banks.find((b) => {
    try { return new RegExp(b.smsPattern, "i").test(sender); }
    catch { return false; }
  });

  if (matchedBank) {
    logger.info("[STEP 4] ✅ Bank matched by smsPattern", { bank: matchedBank.name, smsPattern: matchedBank.smsPattern });
  }

  // Fallback: match by shortCode if parseSms identified one
  if (!matchedBank && parsed.bankShortCode) {
    matchedBank = banks.find(
      (b) => b.shortCode.toUpperCase() === parsed.bankShortCode!.toUpperCase(),
    );
    if (matchedBank) {
      logger.info("[STEP 4] ✅ Bank matched by shortCode fallback", { bank: matchedBank.name, shortCode: parsed.bankShortCode });
    }
  }

  if (!matchedBank) {
    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { parseError: "NO_BANK_MATCHED" },
    });
    logger.warn("[STEP 4] ❌ STOPPED — NO_BANK_MATCHED", {
      sender,
      parsedShortCode: parsed.bankShortCode,
      hint: banks.length === 0
        ? "No banks exist in DB for this user — add a bank first"
        : "Sender does not match any smsPattern in the Bank table",
    });
    return null;
  }

  // 5. Find or create BankAccount
  const accountNumber = parsed.accountNumber ?? "0000";
  const accountType: AccountType =
    parsed.transactionMode === "CARD" ? "CREDIT_CARD" : "SAVINGS";
  logger.info("[STEP 5] Looking up BankAccount", { accountNumber, bankId: matchedBank.id });

  let bankAccount = await prisma.bankAccount.findFirst({
    where: { userId, bankId: matchedBank.id, accountNumber },
  });

  if (!bankAccount) {
    bankAccount = await prisma.bankAccount.create({
      data: { userId, bankId: matchedBank.id, accountNumber, accountType, currency: "INR" },
    });
    logger.info("[STEP 5] ✅ BankAccount auto-created", { accountNumber, bankId: matchedBank.id });
  } else {
    logger.info("[STEP 5] ✅ BankAccount found", { accountId: bankAccount.id });
  }

  // 6. Build description
  const description =
    parsed.type === "CREDIT"
      ? `Received from ${parsed.fromIdentifier ?? "unknown"}`
      : `Payment to ${parsed.merchant ?? parsed.toIdentifier ?? "unknown"}`;

  // 6b. Semantic duplicate check — same account + amount + type on the same calendar day
  const txDate = parsed.transactionDate ?? receivedAt;
  const dayStart = new Date(txDate); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(txDate); dayEnd.setHours(23, 59, 59, 999);

  const semanticDup = await prisma.transaction.findFirst({
    where: {
      userId,
      accountId: bankAccount.id,
      type: parsed.type,
      amount: parsed.amount,
      smsDate: { gte: dayStart, lte: dayEnd },
    },
    select: { id: true },
  });
  if (semanticDup) {
    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { parseError: "DUPLICATE_TRANSACTION", parsedTransactionId: semanticDup.id },
    });
    logger.info("[STEP 6b] ⏭  SKIPPED — semantic duplicate (same account/amount/type/day)", {
      existingTransactionId: semanticDup.id,
      amount: parsed.amount,
      type: parsed.type,
      day: dayStart.toISOString().slice(0, 10),
    });
    return null;
  }

  // 7. Create Transaction
  logger.info("[STEP 7] Creating Transaction", {
    type: parsed.type,
    amount: parsed.amount,
    currency: parsed.currency,
    merchant: parsed.merchant,
    transactionMode: parsed.transactionMode,
    category: parsed.category,
  });

  const transaction = await prisma.transaction.create({
    data: {
      userId,
      accountId: bankAccount.id,
      bankId: matchedBank.id,
      type: parsed.type,
      amount: parsed.amount,
      currency: parsed.currency,
      balance: parsed.balance,
      description,
      merchant: parsed.merchant,
      fromIdentifier: parsed.fromIdentifier,
      toIdentifier: parsed.toIdentifier,
      transactionMode: parsed.transactionMode,
      category: parsed.category,
      rawSms: body,
      smsDate: parsed.transactionDate ?? receivedAt,
      reference: parsed.reference,
    },
  });
  logger.info("[STEP 7] ✅ Transaction created", { transactionId: transaction.id });

  // 8. Update account balance if provided
  if (parsed.balance !== undefined) {
    await prisma.bankAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: parsed.balance },
    });
    logger.info("[STEP 8] ✅ BankAccount balance updated", { balance: parsed.balance });
  }

  // 9. Mark SmsLog as parsed
  await prisma.smsLog.update({
    where: { id: smsLog.id },
    data: { isParsed: true, parsedTransactionId: transaction.id },
  });

  logger.info("━━━ [SMS PIPELINE COMPLETE] ✅ ━━━", {
    transactionId: transaction.id,
    type: parsed.type,
    amount: parsed.amount,
    bank: matchedBank.shortCode,
  });

  return transaction;
}

// ─── batchProcessSms ──────────────────────────────────────────────────────────

export async function batchProcessSms(
  userId: string,
  messages: RawSmsInput[],
): Promise<BatchStats> {
  const stats: BatchStats = { total: messages.length, parsed: 0, skipped: 0, failed: 0 };

  for (const msg of messages) {
    try {
      const result = await processRawSms(userId, msg.sender, msg.body, msg.receivedAt);
      if (result) {
        stats.parsed++;
      } else {
        stats.skipped++;
      }
    } catch (err) {
      stats.failed++;
      logger.error("Failed to process SMS", { sender: msg.sender, error: err });
    }
  }

  logger.info("Batch SMS processing complete", stats);
  return stats;
}
