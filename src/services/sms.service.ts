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
  // 1. Create SmsLog record
  const smsLog = await prisma.smsLog.create({
    data: { userId, sender, body, receivedAt },
  });

  // 2. Parse SMS
  const parsed = parseSms(sender, body);

  if (!parsed) {
    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { parseError: "NO_PATTERN_MATCHED" },
    });
    return null;
  }

  // 3. Skip bill due reminders
  if (parsed.isBillDue) {
    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { parseError: "BILL_DUE_SKIPPED" },
    });
    return null;
  }

  // 4. Find matching bank for this user by testing sender against smsPattern
  const banks = await prisma.bank.findMany({ where: { userId, isActive: true } });
  let matchedBank = banks.find((b) => {
    try { return new RegExp(b.smsPattern, "i").test(sender); }
    catch { return false; }
  });

  // Fallback: match by shortCode if parseSms identified one
  if (!matchedBank && parsed.bankShortCode) {
    matchedBank = banks.find(
      (b) => b.shortCode.toUpperCase() === parsed.bankShortCode!.toUpperCase(),
    );
  }

  if (!matchedBank) {
    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { parseError: "NO_BANK_MATCHED" },
    });
    logger.warn("No bank matched for sender", { sender, userId });
    return null;
  }

  // 5. Find or create BankAccount
  const accountNumber = parsed.accountNumber ?? "0000";
  const accountType: AccountType =
    parsed.transactionMode === "CARD" ? "CREDIT_CARD" : "SAVINGS";

  let bankAccount = await prisma.bankAccount.findFirst({
    where: { userId, bankId: matchedBank.id, accountNumber },
  });

  if (!bankAccount) {
    bankAccount = await prisma.bankAccount.create({
      data: { userId, bankId: matchedBank.id, accountNumber, accountType, currency: "INR" },
    });
    logger.info("Auto-created bank account", { accountNumber, bankId: matchedBank.id });
  }

  // 6. Build description
  const description =
    parsed.type === "CREDIT"
      ? `Received from ${parsed.fromIdentifier ?? "unknown"}`
      : `Payment to ${parsed.merchant ?? parsed.toIdentifier ?? "unknown"}`;

  // 7. Create Transaction
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

  // 8. Update account balance if provided
  if (parsed.balance !== undefined) {
    await prisma.bankAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: parsed.balance },
    });
  }

  // 9. Mark SmsLog as parsed
  await prisma.smsLog.update({
    where: { id: smsLog.id },
    data: { isParsed: true, parsedTransactionId: transaction.id },
  });

  logger.info("SMS processed", {
    type: parsed.type,
    amount: parsed.amount,
    merchant: parsed.merchant,
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
