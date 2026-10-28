import { describe, expect, it } from "vitest";
import { applySeniorFlags, canReturnToAgent, canSeniorApprove, keepSeniorFlags, openSeniorFlags, resolveSeniorFlags, revertItemToAi, seniorReturnSummary, type LineItem } from "./claims";

const base: LineItem = {
  id: "a", photo_index: 0, part: "rear bumper", damage_type: "scratch", severity: "minor",
  action: "repair", confidence: 0.9, bbox: [0, 0, 10, 10], rationale: "",
};
const items: LineItem[] = [base, { ...base, id: "b", part: "hood" }];

describe("senior revision flags", () => {
  it("approve is unavailable while any line item is flagged", () => {
    expect(canSeniorApprove({})).toBe(true);
    expect(canSeniorApprove({ a: "Labor too high" })).toBe(false);
    expect(canSeniorApprove({ a: "" })).toBe(false);
  });

  it("return to agent needs at least one flag and a note on every flagged item", () => {
    expect(canReturnToAgent({})).toBe(false);
    expect(canReturnToAgent({ a: "Labor too high", b: "  " })).toBe(false);
    expect(canReturnToAgent({ a: "Labor too high", b: "Check the hood photo" })).toBe(true);
  });

  it("pins each note to its own line item only", () => {
    const next = applySeniorFlags(items, { b: " Use 1.5 h " }, "2026-10-22T00:00:00Z");
    expect(next[0]!.senior_flag).toBeUndefined();
    expect(next[1]!.senior_flag).toEqual({ note: "Use 1.5 h", at: "2026-10-22T00:00:00Z", resolved: false });
    expect(openSeniorFlags(next).map((i) => i.id)).toEqual(["b"]);
    expect(() => applySeniorFlags(items, { a: "" })).toThrow();
  });

  it("returning clears the Accept/Reject decision on flagged items only, so the agent must re-decide them", () => {
    const decided: LineItem[] = [
      { ...base, review_decision: "accepted", labor_hours_override: 2 },
      { ...base, id: "b", part: "hood", review_decision: "rejected", rejection_reason: "Pre-existing" },
      { ...base, id: "c", part: "trunk", review_decision: "accepted" },
    ];
    const next = applySeniorFlags(decided, { a: "Labor too high", b: "Hood damage is visible in photo 2" });
    expect(next[0]!.review_decision).toBeUndefined();
    expect(next[0]!.labor_hours_override).toBe(2);
    expect(next[1]!.review_decision).toBeUndefined();
    expect(next[1]!.rejection_reason).toBeNull();
    expect(next[2]!.review_decision).toBe("accepted");
  });

  it("resubmitting resolves the notes but keeps them for the record", () => {
    const resolved = resolveSeniorFlags(applySeniorFlags(items, { a: "Use 1.5 h" }));
    expect(openSeniorFlags(resolved)).toEqual([]);
    expect(resolved[0]!.senior_flag?.note).toBe("Use 1.5 h");
    expect(resolved[0]!.senior_flag?.resolved).toBe(true);
  });

  it("reverting or re-running the AI keeps the senior's note on the item", () => {
    const flagged = applySeniorFlags(items, { a: "Use 1.5 h" });
    expect(revertItemToAi(flagged[0]!, base).senior_flag?.note).toBe("Use 1.5 h");
    expect(keepSeniorFlags(items, flagged)[0]!.senior_flag?.note).toBe("Use 1.5 h");
  });

  it("summarises the flagged items for the queue", () => {
    expect(seniorReturnSummary([{ n: 1, part: "rear bumper" }, { n: 3, part: "hood" }])).toBe("2 line items flagged for revision: #1 Rear Bumper, #3 Hood");
  });
});
