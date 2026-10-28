import { beforeEach, describe, expect, it } from "vitest";
import { clearAllSettlements, clearSettlement, quoteTotal, quoteTotals, readSettlement, settlementKey, settlementLabel, type QuoteRow } from "./settlement";

describe("repair & settlement status", () => {
  it("starts as awaiting shop quote", () => {
    expect(settlementLabel({})).toBe("Awaiting shop quote");
  });
  it("moves to negotiating once the shop quote is recorded", () => {
    expect(settlementLabel({ quoteAt: "2026-10-20T10:00:00Z" })).toBe("Negotiating final price");
  });
  it("moves to pending inspection once the final price is agreed", () => {
    expect(settlementLabel({ quoteAt: "x", agreedAt: "y" })).toBe("Pending inspection");
  });
  it("is ready to close after inspection sign-off", () => {
    expect(settlementLabel({ quoteAt: "x", agreedAt: "y", inspectedAt: "z" })).toBe("Ready to close");
  });
  it("is closed after settlement", () => {
    expect(settlementLabel({ quoteAt: "x", agreedAt: "y", inspectedAt: "z", closedAt: "w" })).toBe("Closed");
  });
});

describe("resetting tracking", () => {
  beforeEach(() => localStorage.clear());
  it("Reset demo clears a closed claim's tracking back to awaiting shop quote", () => {
    localStorage.setItem(settlementKey("CLM-24-10421"), JSON.stringify({ quoteAt: "x", agreedAt: "y", inspectedAt: "z", closedAt: "w" }));
    localStorage.setItem("claimlens-role", "junior");
    clearAllSettlements();
    expect(settlementLabel(readSettlement("CLM-24-10421"))).toBe("Awaiting shop quote");
    expect(localStorage.getItem("claimlens-role")).toBe("junior");
  });
  it("re-approving a claim clears only that claim's tracking", () => {
    localStorage.setItem(settlementKey("A"), JSON.stringify({ closedAt: "w" }));
    localStorage.setItem(settlementKey("B"), JSON.stringify({ closedAt: "w" }));
    clearSettlement("A");
    expect(settlementLabel(readSettlement("A"))).toBe("Awaiting shop quote");
    expect(settlementLabel(readSettlement("B"))).toBe("Closed");
  });
});

describe("shop quote totals", () => {
  const row = (hours: string, price: string): QuoteRow => ({ id: Math.random().toString(), part: "p", damage: "d", action: "a", hours, price });
  it("adds parts prices and labor hours at the shop's hourly rate", () => {
    expect(quoteTotals([row("2.0", "185.60"), row("1.5", "1,200")], "50")).toEqual({ parts: 1385.6, hours: 3.5, labor: 175, total: 1560.6 });
  });
  it("uses the shop's own labor rate when it differs from $50/hour", () => {
    expect(quoteTotals([row("2", "100")], "65").total).toBe(230);
  });
  it("falls back to the single typed quote for older saved tracking", () => {
    expect(quoteTotal({ quoteRows: [], laborRate: "50", quote: "5,555" })).toBe(5555);
  });
});
