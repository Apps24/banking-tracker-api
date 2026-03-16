import { TransactionCategory, TransactionMode } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParsedSms = {
  type: "CREDIT" | "DEBIT";
  amount: number;
  currency: "INR";
  balance?: number;
  merchant?: string;
  toIdentifier?: string;
  fromIdentifier?: string;
  accountNumber?: string;
  reference?: string;
  transactionDate?: Date;
  transactionMode: TransactionMode;
  category: TransactionCategory;
  bankShortCode?: string;
  isBillDue?: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseAmount(text: string): number {
  const cleaned = text.replace(/,/g, "").replace(/Rs\.?|INR|₹/gi, "").trim();
  return parseFloat(cleaned) || 0;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date();

  // "YYYY-MM-DD" or "YYYY-MM-DD:HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return new Date(dateStr.slice(0, 10) + "T00:00:00+05:30");
  }

  // "DD/MM/YY" e.g. "06/03/26"
  const slashMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (slashMatch) {
    const [, dd, mm, yy] = slashMatch;
    return new Date(`20${yy}-${mm}-${dd}T00:00:00+05:30`);
  }

  // "DD-MM-YYYY" e.g. "21-02-2026"
  const dashNum4Match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dashNum4Match) {
    const [, dd, mm, yyyy] = dashNum4Match;
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00+05:30`);
  }

  // "DD-MM-YY" e.g. "27-02-26"
  const dashNumMatch = dateStr.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (dashNumMatch) {
    const [, dd, mm, yy] = dashNumMatch;
    return new Date(`20${yy}-${mm}-${dd}T00:00:00+05:30`);
  }

  // "DD-Mon-YY" / "DD-MON-YY" e.g. "01-Jan-25"
  const dashMonMatch = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (dashMonMatch) {
    const [, dd, mon, yy] = dashMonMatch;
    const mm = MONTHS[mon.toLowerCase()] ?? "01";
    const year = yy.length === 2 ? `20${yy}` : yy;
    return new Date(`${year}-${mm}-${dd.padStart(2, "0")}T00:00:00+05:30`);
  }

  return new Date();
}

function detectTransactionMode(body: string): TransactionMode {
  if (/UPI Mandate/i.test(body)) return "UPI_MANDATE";
  if (/NEFT/i.test(body)) return "NEFT";
  if (/IMPS/i.test(body)) return "IMPS";
  if (/RTGS/i.test(body)) return "RTGS";
  if (/ATM WDL|Cash Withdrawal/i.test(body)) return "ATM";
  if (/Credit Card|Bank Card/i.test(body)) return "CARD";
  if (/EMI/i.test(body)) return "EMI";
  if (/Amt Due/i.test(body)) return "BILL_DUE";
  if (/UPI|@/i.test(body)) return "UPI";
  return "OTHER";
}

function categorize(
  merchant?: string,
  toId?: string,
  fromId?: string,
  mode?: TransactionMode,
): TransactionCategory {
  if (mode === "BILL_DUE") return "OTHER";
  const text = [merchant, toId, fromId].filter(Boolean).join(" ").toLowerCase();
  if (!text) {
    if (mode === "NEFT" || mode === "RTGS" || mode === "IMPS") return "TRANSFER";
    if (mode === "ATM") return "ATM";
    if (mode === "EMI") return "EMI";
    return "OTHER";
  }
  if (/zomato|swiggy|dominos|pizza|restaurant|biryani|cafe|food|blinkit|zepto|bigbasket/.test(text)) return "FOOD";
  if (/uber|ola|rapido|metro|irctc|train|bus|flight|indigo|spicejet|redbus/.test(text)) return "TRANSPORT";
  if (/amazon|flipkart|myntra|meesho|ajio|nykaa|jiomart/.test(text)) return "SHOPPING";
  if (/electricity|bescom|mseb|tata power|airtel|jio|vi |bsnl|broadband|dth|recharge/.test(text)) return "UTILITIES";
  if (/netflix|hotstar|disney|spotify|prime video|zee5|youtube|apple tv|claude/.test(text)) return "ENTERTAINMENT";
  if (/hospital|pharmacy|apollo|1mg|netmeds|medplus|doctor|clinic|health/.test(text)) return "HEALTH";
  if (/school|college|udemy|coursera|byju|unacademy|fee|tuition/.test(text)) return "EDUCATION";
  if (/salary|payroll|wages|stipend/.test(text)) return "SALARY";
  if (/atm wdl|cash withdrawal|atm\/pos/.test(text)) return "ATM";
  if (/emi|equated|loan repay|lending|kredit/.test(text)) return "EMI";
  if (/jar|fi money|jupiter|niyo/.test(text)) return "TRANSFER";
  if (mode === "NEFT" || mode === "RTGS" || mode === "IMPS") return "TRANSFER";
  return "OTHER";
}

// ─── HDFC Patterns ────────────────────────────────────────────────────────────

function tryHdfc(body: string): ParsedSms | null {
  // H1 — UPI Debit multiline
  const h1 = body.match(
    /Sent Rs\.([\d,]+\.?\d*)\s*[\r\n]+From HDFC Bank A\/[Cc]\s*[*]?(\d{4})\s*[\r\n]+To ([^\r\n]+)\s*[\r\n]+On (\d{2}\/\d{2}\/\d{2})\s*[\r\n]+Ref\s*(\d+)/i,
  );
  if (h1) {
    const merchant = h1[3].trim();
    return {
      type: "DEBIT", amount: parseAmount(h1[1]), currency: "INR",
      accountNumber: h1[2], toIdentifier: merchant, merchant,
      transactionDate: parseDate(h1[4]), reference: h1[5],
      transactionMode: "UPI", category: categorize(merchant, merchant, undefined, "UPI"),
    };
  }

  // H2 — UPI Mandate Debit multiline
  const h2 = body.match(
    /UPI Mandate:?\s*[\r\n]+Sent Rs\.([\d,]+\.?\d*)\s*[\r\n]+from HDFC Bank A\/[Cc]\s*[*]?(\d{4})\s*[\r\n]+To ([^\r\n]+)\s*[\r\n]+(\d{2}\/\d{2}\/\d{2})\s*[\r\n]+Ref\s*(\d+)/i,
  );
  if (h2) {
    const merchant = h2[3].trim();
    return {
      type: "DEBIT", amount: parseAmount(h2[1]), currency: "INR",
      accountNumber: h2[2], toIdentifier: merchant, merchant,
      transactionDate: parseDate(h2[4]), reference: h2[5],
      transactionMode: "UPI_MANDATE", category: categorize(merchant, merchant, undefined, "UPI_MANDATE"),
    };
  }

  // H3 — UPI Credit
  const h3 = body.match(
    /Rs\.([\d,]+\.?\d*)\s*credited to HDFC Bank A\/[Cc]\s*(?:XX)?(\d{4})\s*on\s*([\d-]+)\s*from VPA\s*([^\s(]+)\s*\(UPI\s*(\d+)\)/i,
  );
  if (h3) {
    const fromId = h3[4];
    return {
      type: "CREDIT", amount: parseAmount(h3[1]), currency: "INR",
      accountNumber: h3[2], fromIdentifier: fromId,
      transactionDate: parseDate(h3[3]), reference: h3[5],
      transactionMode: "UPI", category: categorize(undefined, undefined, fromId, "UPI"),
    };
  }

  // H4 — Credit Card Debit
  const h4 = body.match(
    /Spent Rs\.([\d,]+\.?\d*)\s*On HDFC Bank Card\s*(\d{4})\s*At\s*(.+?)\s*On\s*(\d{4}-\d{2}-\d{2})/i,
  );
  if (h4) {
    const merchant = h4[3].trim();
    return {
      type: "DEBIT", amount: parseAmount(h4[1]), currency: "INR",
      accountNumber: h4[2], toIdentifier: merchant, merchant,
      transactionDate: parseDate(h4[4]),
      transactionMode: "CARD", category: categorize(merchant, merchant, undefined, "CARD"),
    };
  }

  // H6 — Classic debit (older format)
  const h6 = body.match(
    /Rs\.([\d,]+\.?\d*)\s*debited from a\/c\s*[*]{0,2}(\d{4})\s*on\s*([\d\w-]+)\.?\s*Info:\s*([^.]+)\.\s*Bal\s*Rs\.([\d,]+\.?\d*)/i,
  );
  if (h6) {
    const merchant = h6[4].trim();
    return {
      type: "DEBIT", amount: parseAmount(h6[1]), currency: "INR",
      accountNumber: h6[2], transactionDate: parseDate(h6[3]),
      toIdentifier: merchant, merchant, balance: parseAmount(h6[5]),
      transactionMode: "UPI", category: categorize(merchant, merchant, undefined, "UPI"),
    };
  }

  return null;
}

// ─── DBS Patterns ─────────────────────────────────────────────────────────────

function tryDbs(body: string): ParsedSms | null {
  // D1 — Debit
  const d1 = body.match(
    /DBS Bank:?\s*INR\s*([\d,]+\.?\d*)\s*debited from a\/c\s*(?:XX)?(\d{4})\s*on\s*([\d\w\s-]+?)\.\s*Info:\s*([^.]+)\.\s*Avl Bal\s*INR\s*([\d,]+\.?\d*)/i,
  );
  if (d1) {
    const merchant = d1[4].trim();
    const mode = detectTransactionMode(body);
    return {
      type: "DEBIT", amount: parseAmount(d1[1]), currency: "INR",
      accountNumber: d1[2], transactionDate: parseDate(d1[3].trim()),
      toIdentifier: merchant, merchant, balance: parseAmount(d1[5]),
      transactionMode: mode, category: categorize(merchant, merchant, undefined, mode),
    };
  }

  // D2 — Credit via NEFT/IMPS
  const d2 = body.match(
    /DBS Bank:?\s*INR\s*([\d,]+\.?\d*)\s*credited to a\/c\s*(?:XX)?(\d{4})\s*on\s*([\d\w\s-]+?)\s*via\s*(\w+)\.\s*UTR:\s*([^\s.]+)/i,
  );
  if (d2) {
    const modeStr = d2[4].toUpperCase();
    const mode: TransactionMode =
      modeStr === "NEFT" ? "NEFT" : modeStr === "IMPS" ? "IMPS" : modeStr === "RTGS" ? "RTGS" : "UPI";
    return {
      type: "CREDIT", amount: parseAmount(d2[1]), currency: "INR",
      accountNumber: d2[2], transactionDate: parseDate(d2[3].trim()),
      fromIdentifier: d2[4], reference: d2[5],
      transactionMode: mode, category: categorize(undefined, undefined, d2[4], mode),
    };
  }

  // D3 — UPI Debit alternate
  const d3 = body.match(
    /DBS.*?:\s*INR\s*([\d,]+\.?\d*)\s*sent from a\/c\s*(?:XX)?(\d{4})\s*to\s*([^\s]+)\s*via\s*(\w+)\s*on\s*([\d/]+)\.\s*Ref:\s*(\d+)/i,
  );
  if (d3) {
    const merchant = d3[3].trim();
    const modeStr = d3[4].toUpperCase();
    const mode: TransactionMode = modeStr === "UPI" ? "UPI" : "OTHER";
    return {
      type: "DEBIT", amount: parseAmount(d3[1]), currency: "INR",
      accountNumber: d3[2], toIdentifier: merchant, merchant,
      transactionDate: parseDate(d3[5]), reference: d3[6],
      transactionMode: mode, category: categorize(merchant, merchant, undefined, mode),
    };
  }

  // D4 — "Dear Customer, Your account no ****9759 is debited with INR X on DD-MM-YYYY. Current Balance is INRX"
  const d4 = body.match(
    /account no\s+[*]+(\d{4})\s+is debited with INR\s*([\d,]+\.?\d*)\s+on\s+([\d-]+)\..*?Current Balance is INR\s*([\d,]+\.?\d*)/i,
  );
  if (d4) {
    const mode = detectTransactionMode(body);
    return {
      type: "DEBIT", amount: parseAmount(d4[2]), currency: "INR",
      accountNumber: d4[1], transactionDate: parseDate(d4[3]),
      balance: parseAmount(d4[4]),
      transactionMode: mode, category: categorize(undefined, undefined, undefined, mode),
      bankShortCode: "DBS",
    };
  }

  // D5 — "Your account no ****XXXX is credited with INR X on DD-MM-YYYY. Current Balance is INRX"
  const d5 = body.match(
    /account no\s+[*]+(\d{4})\s+is credited with INR\s*([\d,]+\.?\d*)\s+on\s+([\d-]+)\..*?Current Balance is INR\s*([\d,]+\.?\d*)/i,
  );
  if (d5) {
    const mode = detectTransactionMode(body);
    return {
      type: "CREDIT", amount: parseAmount(d5[2]), currency: "INR",
      accountNumber: d5[1], transactionDate: parseDate(d5[3]),
      balance: parseAmount(d5[4]),
      transactionMode: mode, category: categorize(undefined, undefined, undefined, mode),
      bankShortCode: "DBS",
    };
  }

  return null;
}

// ─── ICICI Patterns ───────────────────────────────────────────────────────────

function tryIcici(body: string): ParsedSms | null {
  // I1 — Classic debit
  const i1 = body.match(
    /ICICI Bank Acct\s*(?:XX)?(\d{4})\s*debited for Rs\s*([\d,]+\.?\d*)\s*on\s*([\d\w-]+);([^;]+);Avbl Bal:Rs\s*([\d,]+\.?\d*)/i,
  );
  if (i1) {
    const merchant = i1[4].trim();
    return {
      type: "DEBIT", amount: parseAmount(i1[2]), currency: "INR",
      accountNumber: i1[1], transactionDate: parseDate(i1[3]),
      toIdentifier: merchant, merchant, balance: parseAmount(i1[5]),
      transactionMode: "UPI", category: categorize(merchant, merchant, undefined, "UPI"),
    };
  }

  // I2 — UPI Debit newer format
  const i2 = body.match(
    /Rs\.?([\d,]+\.?\d*)\s*debited from Acct\s*[*]{0,2}(\d{4})\s*on\s*([\d\w-]+)\s*to\s*([^.]+)\.\s*Avbl Bal:\s*Rs\.?([\d,]+\.?\d*)/i,
  );
  if (i2) {
    const merchant = i2[4].trim();
    return {
      type: "DEBIT", amount: parseAmount(i2[1]), currency: "INR",
      accountNumber: i2[2], transactionDate: parseDate(i2[3]),
      toIdentifier: merchant, merchant, balance: parseAmount(i2[5]),
      transactionMode: "UPI", category: categorize(merchant, merchant, undefined, "UPI"),
    };
  }

  // I3 — Credit
  const i3 = body.match(
    /INR\s*([\d,]+\.?\d*)\s*credited to your A\/c No\.?\s*(?:XX)?(\d{4})\s*on\s*([\d\w-]+)\s*from\s*(\w+)\.?\s*UTR No\.?([^\s.]+)/i,
  );
  if (i3) {
    const modeStr = i3[4].toUpperCase();
    const mode: TransactionMode =
      modeStr === "NEFT" ? "NEFT" : modeStr === "IMPS" ? "IMPS" : modeStr === "RTGS" ? "RTGS" : "UPI";
    return {
      type: "CREDIT", amount: parseAmount(i3[1]), currency: "INR",
      accountNumber: i3[2], transactionDate: parseDate(i3[3]),
      fromIdentifier: i3[4], reference: i3[5],
      transactionMode: mode, category: categorize(undefined, undefined, i3[4], mode),
    };
  }

  // I4 — Card Debit
  const i4 = body.match(
    /ICICI Bank.*?Card\s*(?:XX)?(\d{4})\s*transaction of Rs\.?([\d,]+\.?\d*)\s*at\s*([^\s].+?)\s*on\s*([\d\w-]+)/i,
  );
  if (i4) {
    const merchant = i4[3].trim();
    return {
      type: "DEBIT", amount: parseAmount(i4[2]), currency: "INR",
      accountNumber: i4[1], toIdentifier: merchant, merchant,
      transactionDate: parseDate(i4[4]),
      transactionMode: "CARD", category: categorize(merchant, merchant, undefined, "CARD"),
    };
  }

  return null;
}

// ─── Generic Fallbacks ────────────────────────────────────────────────────────

function tryGeneric(body: string): ParsedSms | null {
  const mode = detectTransactionMode(body);

  const debitMatch = body.match(/(?:Rs\.?|INR)\s*([\d,]+\.?\d*)\s*(?:debited|sent|spent)/i);
  if (debitMatch) {
    return {
      type: "DEBIT", amount: parseAmount(debitMatch[1]), currency: "INR",
      transactionMode: mode, category: categorize(undefined, undefined, undefined, mode),
    };
  }

  const creditMatch = body.match(/(?:Rs\.?|INR)\s*([\d,]+\.?\d*)\s*(?:credited|received)/i);
  if (creditMatch) {
    return {
      type: "CREDIT", amount: parseAmount(creditMatch[1]), currency: "INR",
      transactionMode: mode, category: categorize(undefined, undefined, undefined, mode),
    };
  }

  return null;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function parseSms(sender: string, body: string): ParsedSms | null {
  const s = sender.toUpperCase();

  const isHdfc  = /HDFCBK|HDFCBANK/i.test(s);
  const isDbs   = /DBSBNK|DBSBANK/i.test(s);
  const isIcici = /ICICIB|ICICIBANK/i.test(s);

  // Bill due check (HDFC)
  if (isHdfc) {
    const billDue = body.match(/Amt Due:?\s*Rs\.?\s*([\d,]+)\s*on HDFC Bank Credit Card\s*(\d{4})/i);
    if (billDue) {
      return {
        type: "DEBIT", amount: parseAmount(billDue[1]), currency: "INR",
        accountNumber: billDue[2], transactionMode: "BILL_DUE",
        category: "OTHER", isBillDue: true,
      };
    }
  }

  // Bank-specific patterns
  if (isHdfc)  { const r = tryHdfc(body);  if (r) return { ...r, bankShortCode: "HDFC" };  }
  if (isDbs)   { const r = tryDbs(body);   if (r) return { ...r, bankShortCode: "DBS" };   }
  if (isIcici) { const r = tryIcici(body); if (r) return { ...r, bankShortCode: "ICICI" }; }

  // Generic fallback
  return tryGeneric(body);
}
