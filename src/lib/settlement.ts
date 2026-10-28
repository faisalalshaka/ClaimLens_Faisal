// Manual post-approval tracking (shop quote → negotiation → inspection → close).
// Demo-only: saved in the browser per claim, outside the automated workflow.
import { LABOR_RATE, parseAmount } from "./claims";

/** One line of the repair shop's quote, typed in by the agent from the uploaded document. */
export type QuoteRow = { id: string; part: string; damage: string; action: string; hours: string; price: string; authId?: string };
export type QuoteFile = { path: string; name: string };

export type Settlement = {
  shop: string; quote: string; quoteNote: string; quoteAt?: string;
  quoteRows: QuoteRow[]; laborRate: string; quoteFile?: QuoteFile | undefined;
  agreed: string; negotiationNote: string; agreedAt?: string;
  inspectionPassed: boolean; inspectionNote: string; inspectedAt?: string;
  closedAt?: string;
};

export const EMPTY_SETTLEMENT: Settlement = { shop: "", quote: "", quoteNote: "", quoteRows: [], laborRate: String(LABOR_RATE), agreed: "", negotiationNote: "", inspectionPassed: false, inspectionNote: "" };
const PREFIX = "claimlens-settlement-";
export const settlementKey = (id: string) => `${PREFIX}${id}`;

/** 0 = awaiting quote, 1 = quote recorded, 2 = price agreed, 3 = inspected, 4 = closed. */
export function settlementStage(s: Partial<Settlement>): number {
  return s.closedAt ? 4 : s.inspectedAt ? 3 : s.agreedAt ? 2 : s.quoteAt ? 1 : 0;
}

export const SETTLEMENT_LABELS = ["Awaiting shop quote", "Negotiating final price", "Pending inspection", "Ready to close", "Closed"] as const;
export type SettlementLabel = (typeof SETTLEMENT_LABELS)[number];

export function settlementLabel(s: Partial<Settlement>): SettlementLabel {
  return SETTLEMENT_LABELS[settlementStage(s)] ?? "Awaiting shop quote";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Totals of the shop quote as entered: parts + (hours × shop labor rate). Blank cells count as 0. */
export function quoteTotals(rows: QuoteRow[], laborRate: string) {
  const rate = parseAmount(laborRate) ?? 0;
  const parts = r2(rows.reduce((s, r) => s + (parseAmount(r.price) ?? 0), 0));
  const hours = r2(rows.reduce((s, r) => s + (parseAmount(r.hours) ?? 0), 0));
  const labor = r2(hours * rate);
  return { parts, hours, labor, total: r2(parts + labor) };
}

/** The shop's quoted total; older saves without line rows fall back to the single typed amount. */
export function quoteTotal(s: Pick<Settlement, "quoteRows" | "laborRate" | "quote">): number | null {
  if (s.quoteRows?.length) return quoteTotals(s.quoteRows, s.laborRate).total;
  return parseAmount(s.quote ?? "");
}

export function readSettlement(id: string): Settlement {
  try {
    const raw = localStorage.getItem(settlementKey(id));
    return raw ? { ...EMPTY_SETTLEMENT, ...JSON.parse(raw) } : EMPTY_SETTLEMENT;
  } catch {
    return EMPTY_SETTLEMENT;
  }
}

export function clearSettlement(id: string, storage: Storage = localStorage) {
  storage.removeItem(settlementKey(id));
}

export const SETTLEMENT_RESET_EVENT = "claimlens-settlement-reset";

/** Wipes repair & settlement tracking for every claim (used by Reset demo). */
export function clearAllSettlements(storage: Storage = localStorage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  keys.forEach((k) => storage.removeItem(k));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SETTLEMENT_RESET_EVENT));
}
