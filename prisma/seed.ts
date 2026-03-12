import "dotenv/config";
import { PrismaClient, TransactionType, TransactionCategory, AccountType } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { auth } from "../src/lib/auth";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL_UNPOOLED! });
const prisma = new PrismaClient({ adapter });

// ─── Constants ────────────────────────────────────────────────────────────────

const BANK_SEEDS = [
  { name: "HDFC Bank",  shortCode: "HDFC",  smsPattern: "VM-HDFCBK|AM-HDFCBK",           color: "#003087", accountNumber: "1234" },
  { name: "SBI",        shortCode: "SBI",   smsPattern: "VM-SBIINB|AM-SBIINB|VK-SBIPSG", color: "#2563EB", accountNumber: "5678" },
  { name: "ICICI Bank", shortCode: "ICICI", smsPattern: "VM-ICICIB|AM-ICICIB",             color: "#F97316", accountNumber: "9012" },
  { name: "Axis Bank",  shortCode: "AXIS",  smsPattern: "VM-AXISBK|AM-AXISBK",            color: "#800000", accountNumber: "3456" },
  { name: "Kotak Bank", shortCode: "KOTAK", smsPattern: "VM-KOTAK|AM-KOTAK",              color: "#EF4444", accountNumber: "7890" },
];

const CATEGORIES: TransactionCategory[] = [
  "FOOD", "TRANSPORT", "SHOPPING", "UTILITIES", "ENTERTAINMENT",
  "HEALTH", "EDUCATION", "SALARY", "TRANSFER", "ATM", "EMI", "OTHER",
];

const MERCHANTS: Record<TransactionCategory, string[]> = {
  FOOD:          ["Swiggy", "Zomato", "McDonald's", "Pizza Hut", "Domino's"],
  TRANSPORT:     ["Ola", "Uber", "IRCTC", "MakeMyTrip", "RedBus"],
  SHOPPING:      ["Amazon", "Flipkart", "Myntra", "Ajio", "Nykaa"],
  UTILITIES:     ["Airtel", "Jio", "BSES", "Tata Power", "Mahanagar Gas"],
  ENTERTAINMENT: ["Netflix", "Amazon Prime", "Hotstar", "Spotify", "BookMyShow"],
  HEALTH:        ["Apollo Pharmacy", "Medplus", "1mg", "PharmEasy", "Netmeds"],
  EDUCATION:     ["Udemy", "Coursera", "Byju's", "Unacademy", "LinkedIn Learning"],
  SALARY:        ["Employer Ltd"],
  TRANSFER:      ["NEFT Transfer", "IMPS Transfer", "UPI Transfer"],
  ATM:           ["ATM Withdrawal"],
  EMI:           ["Home Loan EMI", "Car Loan EMI", "Personal Loan EMI"],
  OTHER:         ["Miscellaneous", "Unknown Merchant"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

function randomItem<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(randomInt(8, 22), randomInt(0, 59), randomInt(0, 59), 0);
  return d;
}

function buildSms(
  type: TransactionType,
  amount: number,
  merchant: string,
  accountNumber: string,
  balance: number,
  bankShortCode: string,
): string {
  const amtStr = amount.toFixed(2);
  const balStr = balance.toFixed(2);
  if (type === "CREDIT") {
    return `${bankShortCode}: INR ${amtStr} credited to A/c XX${accountNumber} from ${merchant}. Avl Bal: INR ${balStr}.`;
  }
  return `${bankShortCode}: INR ${amtStr} debited from A/c XX${accountNumber} at ${merchant}. Avl Bal: INR ${balStr}.`;
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding database...");

  // Clean up existing seed data
  await prisma.smsLog.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.bankAccount.deleteMany({});
  await prisma.bank.deleteMany({});
  // Remove existing test user via Better Auth (cascades session/account/verification)
  const existingUser = await prisma.user.findUnique({ where: { email: "test@example.com" } });
  if (existingUser) {
    await prisma.user.delete({ where: { id: existingUser.id } });
  }

  // 1. Create user via Better Auth (handles password hashing + session tables)
  const signUpResult = await auth.api.signUpEmail({
    body: { email: "test@example.com", password: "Test@123", name: "Test User" },
  });
  const user = signUpResult.user;
  console.log(`✅ Created user: ${user.email}`);

  // 2. Create banks + accounts
  const createdBanks: { bankId: string; accountId: string; shortCode: string; accountNumber: string }[] = [];

  for (const seed of BANK_SEEDS) {
    const bank = await prisma.bank.create({
      data: {
        userId: user.id,
        name: seed.name,
        shortCode: seed.shortCode,
        smsPattern: seed.smsPattern,
        color: seed.color,
        isActive: true,
      },
    });

    const account = await prisma.bankAccount.create({
      data: {
        userId: user.id,
        bankId: bank.id,
        accountNumber: seed.accountNumber,
        accountType: AccountType.SAVINGS,
        currentBalance: parseFloat(randomBetween(10000, 100000).toFixed(2)),
        currency: "INR",
        isActive: true,
      },
    });

    createdBanks.push({ bankId: bank.id, accountId: account.id, shortCode: seed.shortCode, accountNumber: seed.accountNumber });
    console.log(`✅ Created bank: ${seed.name} (account: XX${seed.accountNumber})`);
  }

  // 3. Create 60 random transactions spread over the last 30 days
  const txCount = 60;
  let created = 0;

  for (let i = 0; i < txCount; i++) {
    const bankEntry = randomItem(createdBanks);
    const type: TransactionType = Math.random() > 0.4 ? "DEBIT" : "CREDIT";
    const category = type === "CREDIT" && Math.random() > 0.5 ? "SALARY" : randomItem(CATEGORIES);
    const merchant = randomItem(MERCHANTS[category]);
    const amount = parseFloat(
      (category === "SALARY"
        ? randomBetween(30000, 80000)
        : category === "EMI"
        ? randomBetween(5000, 25000)
        : randomBetween(100, 5000)
      ).toFixed(2),
    );
    const balance = parseFloat(randomBetween(5000, 150000).toFixed(2));
    const smsDate = daysAgo(randomInt(0, 30));

    const rawSms = buildSms(type, amount, merchant, bankEntry.accountNumber, balance, bankEntry.shortCode);

    await prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: bankEntry.accountId,
        bankId: bankEntry.bankId,
        type,
        amount,
        currency: "INR",
        balance,
        description: `${type === "CREDIT" ? "Received from" : "Payment to"} ${merchant}`,
        merchant,
        category,
        rawSms,
        smsDate,
        isVerified: true,
      },
    });
    created++;
  }

  console.log(`✅ Created ${created} transactions`);
  console.log("🎉 Seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
