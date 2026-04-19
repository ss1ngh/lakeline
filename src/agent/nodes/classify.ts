import { AgentState, BorrowerParsedIntent, NegotiationMode } from "../state";

export interface ClassifyStructuredSignals {
  borrowerProposedAmount: number | undefined;
  borrowerIntent: BorrowerParsedIntent;
  isFinancialQuery: boolean;
}

const MONTHLY_RE =
  /\b(monthly|per\s*month|\/\s*month|each\s*month|every\s*month|a\s*month|per\s*mo\b)/i;
const LUMP_RE =
  /\b(lump\s*sum|one[-\s]?time|single\s*payment|pay\s*in\s*full|full\s*payment\s*now|upfront)\b/i;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Extract $ amounts and plain dollar-like numbers from user text. */
function extractDollarAmounts(text: string): number[] {
  const amounts: number[] = [];

  const withSymbol = text.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g);
  for (const m of withSymbol) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) amounts.push(roundMoney(n));
  }

  // "2000 dollars", "pay 2000"
  const wordNum = text.matchAll(
    /\b(?:pay|paying|only|about|around)?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:usd|dollars?)?\b/gi,
  );
  for (const m of wordNum) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 1) amounts.push(roundMoney(n));
  }

  return amounts;
}

function extractPercent(text: string): number | undefined {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return undefined;
  const p = parseFloat(m[1]);
  return Number.isFinite(p) ? p : undefined;
}

function inferBorrowerIntent(
  text: string,
  prevMode: NegotiationMode | null,
): BorrowerParsedIntent {
  const lower = text.toLowerCase();
  const monthly = MONTHLY_RE.test(text) || /\bmonthly\b/i.test(lower);
  const lump = LUMP_RE.test(lower);

  if (monthly && !lump) return "INSTALLMENT";
  if (lump && !monthly) return "LUMP_SUM";
  if (monthly && lump) return "INSTALLMENT";

  if (prevMode === "INSTALLMENT") return "INSTALLMENT";
  if (prevMode === "LUMP_SUM") return "LUMP_SUM";

  return "UNKNOWN";
}

function resolveNegotiationMode(
  text: string,
  prev: NegotiationMode | null,
  borrowerIntent: BorrowerParsedIntent,
): NegotiationMode | null {
  const lower = text.toLowerCase();
  const explicitMonthly =
    MONTHLY_RE.test(text) ||
    /\bmonthly\b/i.test(lower) ||
    borrowerIntent === "INSTALLMENT";
  const explicitLump =
    LUMP_RE.test(lower) || /\b(lump|full\s*settlement|pay\s*off\s*in\s*one)\b/i.test(lower);

  if (explicitMonthly && !explicitLump) return "INSTALLMENT";
  if (explicitLump && !explicitMonthly) return "LUMP_SUM";

  // User changed mind toward lump
  if (prev === "INSTALLMENT" && explicitLump) return "LUMP_SUM";
  // Stay in INSTALLMENT unless user clearly switches
  if (prev === "INSTALLMENT" && !explicitLump) return "INSTALLMENT";
  if (prev === "LUMP_SUM" && explicitMonthly) return "INSTALLMENT";
  if (prev === "LUMP_SUM" && !explicitMonthly) return "LUMP_SUM";

  if (borrowerIntent === "INSTALLMENT") return "INSTALLMENT";
  if (borrowerIntent === "LUMP_SUM") return "LUMP_SUM";

  return prev;
}

function isFinancialQueryText(text: string): boolean {
  const q = text.toLowerCase();
  return (
    /\b(how\s+much|what'?s\s+my|what\s+is\s+my|total\s+debt|outstanding|balance|owe|owed)\b/.test(
      q,
    ) ||
    /\b(what\s+happens\s+next\s+month|next\s+month|future\s+payment|projection)\b/.test(q) ||
    /\b(percent|percentage|%)\b/.test(q) ||
    /\b(installment|plan|schedule)\b/.test(q)
  );
}

export async function classifyIntentNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const lastMsg =
    (state.messages as { content?: string }[])
      .filter((m) => m && typeof m.content === "string")
      .slice(-1)[0]?.content || "";

  const totalDebt = state.totalDebt;
  const prevMode = state.negotiationMode ?? null;
  const prevAnchor = state.lastBorrowerAmount;
  let anchorCount = state.borrowerAnchorCount || 0;

  const percent = extractPercent(lastMsg);
  const dollarAmounts = extractDollarAmounts(lastMsg);
  const hasDollarSign = /\$/.test(lastMsg);

  let borrowerProposedAmount: number | undefined;

  if (hasDollarSign && dollarAmounts.length > 0) {
    borrowerProposedAmount = dollarAmounts[dollarAmounts.length - 1];
  } else if (percent !== undefined) {
    borrowerProposedAmount = roundMoney((percent / 100) * totalDebt);
  } else if (dollarAmounts.length > 0) {
    borrowerProposedAmount = dollarAmounts[dollarAmounts.length - 1];
  }

  const borrowerIntent = inferBorrowerIntent(lastMsg, prevMode);
  const negotiationMode = resolveNegotiationMode(lastMsg, prevMode, borrowerIntent);
  const isFinancialQuery = isFinancialQueryText(lastMsg);

  let lastBorrowerAmount = state.lastBorrowerAmount;

  if (borrowerProposedAmount !== undefined) {
    const same =
      prevAnchor !== undefined &&
      Math.abs(prevAnchor - borrowerProposedAmount) < 0.01;
    if (same) {
      anchorCount = anchorCount + 1;
    } else {
      anchorCount = 1;
    }
    lastBorrowerAmount = borrowerProposedAmount;
  }

  const isAnchorLocked = anchorCount >= 2;

  const lastUserIntent = [
    borrowerIntent !== "UNKNOWN" ? borrowerIntent : "",
    borrowerProposedAmount !== undefined
      ? `$${borrowerProposedAmount}`
      : "",
    negotiationMode ? negotiationMode : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    borrowerProposedAmount,
    borrowerIntent,
    isFinancialQuery,
    negotiationMode,
    borrowerAnchorCount: anchorCount,
    lastBorrowerAmount,
    isAnchorLocked,
    lastUserIntent: lastUserIntent || state.lastUserIntent || "",
    intent: borrowerIntent,
  };
}
