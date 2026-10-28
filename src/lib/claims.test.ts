import { describe, expect, it } from "vitest";
import { addedTextSegments, fmtAmount, parseAmount, canDeleteItem, deleteAgentItem, analyzablePhotoIndices, isFutureDate, todayISO, addPhotos, newClaimRecord, uploadedPhotoIndices, applyManualOverride, fieldOverrideReason, hasOverrides, revertsToOriginal, reviewLineItem, STATUSES, buildCostTable, calcPrice, calcPartsPrice, finalLaborHours, laborTotal, totalLaborHours, parseHours, laborHours, fmtHours, LABOR_RATE, diffItems, estimateTotal, isLowConfidence, sortJuniorQueue, type Claim, type LineItem } from "./claims";

const table = buildCostTable([
  { part: "front bumper", action: "repair", severity: "minor", parts_cost: 16.8, labor_hours: 2, paint_materials_cost: 180 },
  { part: "front bumper", action: "replace", severity: "minor", parts_cost: 420, labor_hours: 2.5, paint_materials_cost: 234 },
]);
const item: LineItem = {
  id: "x", photo_index: 0, part: "front bumper", damage_type: "scratch", severity: "minor",
  action: "repair", confidence: 0.9, bbox: [0, 0, 10, 10], rationale: "",
};

describe("pricing", () => {
  it("labor rate is $50 per hour", () => {
    expect(LABOR_RATE).toBe(50);
  });
  it("price = parts + labor hours × $50 + paint", () => {
    expect(calcPrice(table, item)).toBe(16.8 + 2 * 50 + 180);
  });
  it("recalculates when action changes", () => {
    expect(calcPrice(table, { ...item, action: "replace" })).toBe(420 + 2.5 * 50 + 234);
  });
  it("labor column shows the cost table's hours with one decimal", () => {
    expect(laborHours(table, item)).toBe(2);
    expect(fmtHours(laborHours(table, item))).toBe("2.0 h");
    expect(fmtHours(laborHours(table, { ...item, action: "replace" }))).toBe("2.5 h");
    expect(laborHours(table, { ...item, part: "hood" })).toBeNull();
  });
  it("labor feeds the estimate total", () => {
    const replace = { ...item, id: "y", action: "replace" as const };
    expect(estimateTotal(table, [item, replace])).toBe(16.8 + 180 + 420 + 234 + (2 + 2.5) * 50);
  });
  it("parts price override replaces the parts price; labor is still added", () => {
    expect(estimateTotal(table, [{ ...item, price_override: 100 }])).toBe(100 + 2 * 50);
  });
  it("Parts Price excludes labor", () => {
    expect(calcPartsPrice(table, item)).toBe(16.8 + 180);
  });
  it("edited labor hours change the line price, labor cost and total", () => {
    const edited = { ...item, labor_hours_override: 3.5 };
    expect(finalLaborHours(table, edited)).toBe(3.5);
    expect(laborTotal(table, [edited])).toBe(175);
    expect(estimateTotal(table, [edited])).toBe(16.8 + 180 + 3.5 * 50);
  });
  it("total labor cost sums hours × $50 and skips rejected items", () => {
    const replace = { ...item, id: "y", action: "replace" as const };
    const rejected = { ...item, id: "z", review_decision: "rejected" as const, rejection_reason: "x" };
    expect(totalLaborHours(table, [item, replace, rejected])).toBe(4.5);
    expect(laborTotal(table, [item, replace, rejected])).toBe(225);
  });
  it("typed labor hours accept numbers only, rounded to one decimal", () => {
    expect(parseHours("2")).toBe(2);
    expect(parseHours("2.55")).toBe(2.6);
    expect(parseHours("abc")).toBeNull();
    expect(parseHours("-1")).toBeNull();
  });
  it("editing AI item labor needs a reason and is marked overridden; setting it back clears it", () => {
    expect(() => applyManualOverride(item, { labor_hours_override: 3 }, "", item)).toThrow();
    const o = applyManualOverride(item, { labor_hours_override: 3 }, "Extra blending", item);
    expect(fieldOverrideReason(o, "labor_hours_override", item)).toBe("Extra blending");
    expect(revertsToOriginal({ labor_hours_override: null }, item)).toBe(true);
    const back = applyManualOverride(o, { labor_hours_override: null }, "", item);
    expect(back.labor_hours_override).toBeNull();
    expect(hasOverrides(back, item)).toBe(false);
  });
  it("editing labor on an agent-added item is not an override", () => {
    const added = { ...item, id: "a", confidence: null };
    expect(hasOverrides(applyManualOverride(added, { labor_hours_override: 4 }, ""))).toBe(false);
  });
});

describe("rules", () => {
  it("accepts a line item without removing its attributes", () => {
    expect(reviewLineItem(item, "accepted")).toEqual({ ...item, review_decision: "accepted", rejection_reason: null });
  });
  it("retains rejected items and their required reason", () => {
    const reviewed = [reviewLineItem(item, "rejected", "Pre-existing damage")];
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]).toMatchObject({ id: "x", part: "front bumper", review_decision: "rejected", rejection_reason: "Pre-existing damage" });
    expect(() => reviewLineItem(item, "rejected", " ")).toThrow();
    expect(estimateTotal(table, reviewed)).toBe(0);
  });
  it.each([
    ["part", "rear bumper"], ["damage_type", "dent"], ["severity", "severe"],
    ["action", "replace"], ["price_override", 100], ["rationale", "Verified by agent"],
  ])("marks a manual %s change as overridden with its reason", (field, value) => {
    const result = applyManualOverride(item, { [field]: value }, "Agent verified");
    expect(result.overridden_fields).toContain(field);
    expect(result.manual_override_reason).toBe("Agent verified");
    expect(result[field as keyof LineItem]).toBe(value);
    expect(() => applyManualOverride(item, { [field]: value }, "")).toThrow();
  });
  it("changing a field back to the AI value removes its override without needing a reason", () => {
    const changed = applyManualOverride(item, { damage_type: "dent" }, "Looks like a dent", item);
    expect(revertsToOriginal({ damage_type: "scratch" }, item)).toBe(true);
    const back = applyManualOverride(changed, { damage_type: "scratch" }, "", item);
    expect(back.damage_type).toBe("scratch");
    expect(back.overridden_fields).toEqual([]);
    expect(fieldOverrideReason(back, "damage_type")).toBeNull();
    expect(back.manual_override_reason).toBeNull();
  });
  it("reverting one field keeps other overrides", () => {
    const a = applyManualOverride(item, { severity: "severe" }, "Deep", item);
    const b = applyManualOverride(a, { action: "replace" }, "Cracked", item);
    const c = applyManualOverride(b, { severity: "minor" }, "", item);
    expect(c.overridden_fields).toEqual(["action"]);
    expect(fieldOverrideReason(c, "action")).toBe("Cracked");
  });
  it("setting the price back to the calculated price clears the price override", () => {
    const a = applyManualOverride(item, { price_override: 300 }, "Shop quote", item);
    expect(revertsToOriginal({ price_override: null }, item)).toBe(true);
    const b = applyManualOverride(a, { price_override: null }, "", item);
    expect(b.price_override).toBeNull();
    expect(b.override_reason).toBeNull();
    expect(estimateTotal(table, [b])).toBe(calcPrice(table, item));
    expect(fieldOverrideReason(b, "price_override")).toBeNull();
  });
  it("records each override reason against the field that was changed", () => {
    const a = applyManualOverride(item, { severity: "moderate" }, "Deeper than shown");
    const b = applyManualOverride(a, { price_override: 300 }, "Shop quote");
    expect(fieldOverrideReason(b, "severity")).toBe("Deeper than shown");
    expect(fieldOverrideReason(b, "price_override")).toBe("Shop quote");
    expect(fieldOverrideReason(b, "part")).toBeNull();
    expect(b.override_reason).toBe("Shop quote");
  });
  it("a field that differs from the AI assessment shows as overridden even without saved override metadata", () => {
    const saved: LineItem = { ...item, action: "replace" };
    expect(fieldOverrideReason(saved, "action", item)).toBe("");
    expect(hasOverrides(saved, item)).toBe(true);
    const back = applyManualOverride(saved, { action: "repair" }, "", item);
    expect(fieldOverrideReason(back, "action", item)).toBeNull();
    expect(hasOverrides(back, item)).toBe(false);
  });
  it("includes rationale overrides in the senior change summary", () => {
    const changes = diffItems(table, [item], [applyManualOverride(item, { rationale: "Verified dent" }, "Photo checked")]);
    expect(changes[0]).toMatchObject({ kind: "modified", fields: [{ field: "rationale", from: "", to: "Verified dent" }] });
  });
  it("keeps every status in the junior tracking queue, including submitted and approved", () => {
    const base = { ai_result: null, line_items: [], ai_line_items: [], created_at: "2026-01-01" } as unknown as Claim;
    const result = sortJuniorQueue(STATUSES.map((status) => ({ ...base, id: status, status })));
    expect(result).toHaveLength(5);
    expect(result.map((claim) => claim.status)).toEqual(expect.arrayContaining(["Submitted to senior", "Approved"]));
  });
  it("confidence below 0.80 is low", () => {
    expect(isLowConfidence({ ...item, confidence: 0.79 })).toBe(true);
    expect(isLowConfidence({ ...item, confidence: 0.8 })).toBe(false);
  });
  it("diff detects modified field and override", () => {
    const ch = diffItems(table, [item], [{ ...item, action: "replace", price_override: 50, override_reason: "r" }]);
    expect(ch.map((c) => c.kind).sort()).toEqual(["modified", "override"]);
  });
  it("returned claims sort first", () => {
    const base = { ai_result: null, line_items: [], ai_line_items: [], created_at: "2026-01-01" } as unknown as Claim;
    const sorted = sortJuniorQueue([
      { ...base, id: "a", status: "Ready for agent review" },
      { ...base, id: "b", status: "Returned to agent", created_at: "2026-02-01" },
    ]);
    expect(sorted[0]?.id).toBe("b");
  });
});

describe("new claims and photos", () => {
  const input = {
    policyholder: "Ana Ruiz", policy_number: "PA-123456", vehicle_year: 2021, vehicle_make: "Honda",
    vehicle_model: "Civic", accident_date: "2026-10-01", description: "Rear-ended at a light",
  };
  it("a newly created claim starts in Awaiting customer photos with no photos or AI result", () => {
    const rec = newClaimRecord(input, "CLM-26-12345");
    expect(rec.status).toBe("Awaiting customer photos");
    expect(rec.photos).toEqual([]);
    expect(rec.ai_result).toBeNull();
    expect(rec.line_items).toEqual([]);
  });
  it("claims can hold more than 4 photos", () => {
    const four = ["a", "b", "c", "d"];
    expect(addPhotos(four, ["e", "f"])).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("new photos fill empty slots before being appended", () => {
    expect(addPhotos(["a", null, "c", null], ["x", "y", "z"])).toEqual(["a", "x", "c", "y", "z"]);
  });
  it("maps uploaded photos back to their original positions", () => {
    expect(uploadedPhotoIndices(["a", null, "c", "d", "e"])).toEqual([0, 2, 3, 4]);
  });
});

describe("accident date and photo formats", () => {
  it("rejects accident dates after today", () => {
    expect(isFutureDate("2026-10-23", "2026-10-19")).toBe(true);
    expect(isFutureDate("2026-10-20", "2026-10-19")).toBe(true);
  });
  it("allows today and past accident dates", () => {
    expect(isFutureDate("2026-10-19", "2026-10-19")).toBe(false);
    expect(isFutureDate("2025-12-31", "2026-10-19")).toBe(false);
  });
  it("todayISO uses the local calendar date", () => {
    expect(todayISO(new Date(2026, 9, 19, 23, 30))).toBe("2026-10-19");
  });
  it("skips photos the AI cannot read, such as AVIF, when analyzing", () => {
    expect(analyzablePhotoIndices(["a/1.avif", "a/2.jpeg", null, "a/3.PNG", "a/4.heic"])).toEqual([1, 3]);
  });
});

import { aiResultIsCurrent } from "./claims";
describe("aiResultIsCurrent (re-run keeps the saved AI result when photos are unchanged)", () => {
  const ai = { photo_quality: [], can_assess: true, requires_inspection: false, requires_inspection_reason: null, analyzed_photos: ["a.jpg", "b.jpg"] };
  it("same photos → current", () => expect(aiResultIsCurrent(ai, ["a.jpg", null, "b.jpg"])).toBe(true));
  it("a new photo → re-analyze", () => expect(aiResultIsCurrent(ai, ["a.jpg", "b.jpg", "c.jpg"])).toBe(false));
  it("replaced photo → re-analyze", () => expect(aiResultIsCurrent(ai, ["a.jpg", "x.jpg"])).toBe(false));
  it("no record of analyzed photos → re-analyze", () => expect(aiResultIsCurrent({ photo_quality: [], can_assess: true, requires_inspection: false, requires_inspection_reason: null }, ["a.jpg", "b.jpg"])).toBe(false));
});

import { rowTone } from "./claims";
describe("line-item row colors", () => {
  it("accepted item with no overrides is green", () => {
    expect(rowTone(reviewLineItem(item, "accepted"), item)).toBe("accepted");
  });
  it("rejected item with no overrides is red", () => {
    expect(rowTone(reviewLineItem(item, "rejected", "Pre-existing"), item)).toBe("rejected");
  });
  it("an override keeps the row yellow even after accepting", () => {
    const o = applyManualOverride(item, { severity: "moderate" }, "Deeper than shown", item);
    expect(rowTone(reviewLineItem(o, "accepted"), item)).toBe("overridden");
  });
  it("agent-added items are blue", () => {
    expect(rowTone({ ...item, id: "a", confidence: null })).toBe("added");
    expect(rowTone(reviewLineItem({ ...item, id: "a", confidence: null }, "accepted"))).toBe("added");
  });
  it("unreviewed AI item has no color", () => {
    expect(rowTone(item, item)).toBe("none");
  });
});

describe("deleting line items", () => {
  const added: LineItem = { ...item, id: "agent-1", confidence: null };
  it("agent-added item can be deleted", () => {
    expect(deleteAgentItem([item, added], "agent-1", [item]).map((i) => i.id)).toEqual(["x"]);
  });
  it("AI line item can never be deleted", () => {
    expect(canDeleteItem(item, [item])).toBe(false);
    expect(() => deleteAgentItem([item, added], "x", [item])).toThrow();
  });
});

import { claimOverrideCount } from "./claims";
describe("agent-added line items are never overrides", () => {
  const added: LineItem = { ...item, id: "a1", confidence: null };
  it("editing any field needs no reason and marks nothing overridden", () => {
    const edited = applyManualOverride(added, { severity: "severe", rationale: "changed my mind", price_override: 999 }, "");
    expect(edited.severity).toBe("severe");
    expect(edited.price_override).toBe(999);
    expect(hasOverrides(edited)).toBe(false);
    expect(fieldOverrideReason(edited, "rationale")).toBeNull();
    expect(rowTone(edited)).toBe("added");
  });
  it("old override marks on an agent-added item don't count", () => {
    const legacy: LineItem = { ...added, overridden_fields: ["rationale"], override_reasons: { rationale: "x" } };
    expect(hasOverrides(legacy)).toBe(false);
    expect(claimOverrideCount({ line_items: [legacy], ai_line_items: [] } as unknown as Claim)).toBe(0);
  });
});

describe("price box formatting", () => {
  it("adds thousands commas", () => {
    expect(fmtAmount(1000.56)).toBe("1,000.56");
    expect(fmtAmount(1000000.36)).toBe("1,000,000.36");
    expect(fmtAmount(718.4)).toBe("718.40");
  });
  it("reads typed prices with or without commas", () => {
    expect(parseAmount("1,000.56")).toBe(1000.56);
    expect(parseAmount("$1000")).toBe(1000);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
  });
});

describe("rationale highlighting", () => {
  const added = (o: string, c: string) => addedTextSegments(o, c).filter((s) => s.added).map((s) => s.text.trim());
  it("marks only the text the agent typed", () => {
    expect(added("Possible crack at the fender edge.", "Possible crack at the fender edge. Customer confirmed it.")).toEqual(["Customer confirmed it."]);
  });
  it("marks nothing when the rationale is unchanged", () => {
    expect(added("Dent on door.", "Dent on door.")).toEqual([]);
  });
  it("keeps the full current text in order", () => {
    const segs = addedTextSegments("Dent on door.", "Large dent on door.");
    expect(segs.map((s) => s.text).join("")).toBe("Large dent on door.");
    expect(added("Dent on door.", "Large dent on door.")).toEqual(["Large dent"]);
  });
});

import { joinRationale, splitRationale } from "./claims";
describe("agent feedback in the rationale", () => {
  const ai = "Dent on the front left door.";
  it("keeps the agent's feedback separate from the AI's text", () => {
    const stored = joinRationale(ai, "Customer confirmed it happened in the accident.");
    expect(splitRationale(stored)).toEqual({ base: ai, feedback: "Customer confirmed it happened in the accident." });
  });
  it("adding feedback changes the rationale, so it counts as an override", () => {
    const original: LineItem = { ...item, rationale: ai };
    const edited = applyManualOverride(original, { rationale: joinRationale(ai, "Seen in person") }, "Agent note", original);
    expect(edited.overridden_fields).toContain("rationale");
  });
  it("clearing the feedback returns the rationale to the AI's text", () => {
    const original: LineItem = { ...item, rationale: ai };
    expect(joinRationale(ai, "  ")).toBe(ai);
    expect(revertsToOriginal({ rationale: joinRationale(ai, "") }, original)).toBe(true);
  });
  it("a rationale without feedback is all AI text", () => {
    expect(splitRationale(ai)).toEqual({ base: ai, feedback: "" });
  });
});

import { isFeedbackOnlyChange } from "./claims";
describe("agent feedback needs no extra reason", () => {
  const ai: LineItem = { ...item, rationale: "Dent on the door." };
  it("adding or editing only the feedback skips the reason prompt", () => {
    expect(isFeedbackOnlyChange(ai, { rationale: joinRationale("Dent on the door.", "Seen in person") })).toBe(true);
    const withFb = { ...ai, rationale: joinRationale("Dent on the door.", "Seen") };
    expect(isFeedbackOnlyChange(withFb, { rationale: joinRationale("Dent on the door.", "Seen in person") })).toBe(true);
  });
  it("changing the AI's own text is not a feedback-only change", () => {
    expect(isFeedbackOnlyChange(ai, { rationale: "Large dent on the door." })).toBe(false);
    expect(isFeedbackOnlyChange(ai, { rationale: joinRationale("Dent on the door.", "x"), severity: "severe" })).toBe(false);
  });
});

import { overrideComments } from "./claims";
describe("override comments in agent feedback", () => {
  it("lists each override reason in column order, whatever order the changes were made", () => {
    const a = applyManualOverride(item, { labor_hours_override: 4 }, "Shop data says 4 h", item);
    const b = applyManualOverride(a, { damage_type: "dent" }, "It's a dent", item);
    expect(overrideComments(b, item)).toEqual([
      { field: "damage_type", label: "Damage", reason: "It's a dent" },
      { field: "labor_hours_override", label: "Labor", reason: "Shop data says 4 h" },
    ]);
  });
  it("a reverted column drops its comment; rationale feedback isn't listed", () => {
    const a = applyManualOverride(item, { severity: "severe" }, "Deep", item);
    const b = applyManualOverride(a, { rationale: "x" }, "Agent feedback added", item);
    const c = applyManualOverride(b, { severity: "minor" }, "", item);
    expect(overrideComments(c, item)).toEqual([]);
  });
});

import { partsTotal } from "./claims";
describe("total parts cost", () => {
  it("sums parts prices, skips rejected items and labor", () => {
    const replace = { ...item, id: "y", action: "replace" as const };
    const rejected = { ...item, id: "z", review_decision: "rejected" as const, rejection_reason: "x" };
    expect(partsTotal(table, [item, replace, rejected])).toBe(16.8 + 180 + 420 + 234);
    expect(partsTotal(table, [item]) + laborTotal(table, [item])).toBe(estimateTotal(table, [item]));
  });
});

import { itemOverrideCount, OVERRIDE_SECTIONS, canDeletePhoto as canDelPhoto, removePhoto as rmPhoto } from "./claims";
describe("7-section override model", () => {
  const ai = { id: "a", photo_index: 0, part: "hood", damage_type: "dent", severity: "minor", action: "repair", confidence: 0.9, bbox: [0, 0, 1, 1], rationale: "Dent." } as never as import("./claims").LineItem;
  it("has 7 sections", () => expect(OVERRIDE_SECTIONS.length).toBe(7));
  it("counts labor and custom feedback, not column reasons", () => {
    const withAction = { ...ai, action: "replace", overridden_fields: ["action"], override_reasons: { action: "clips" } } as typeof ai;
    expect(itemOverrideCount(withAction, ai)).toBe(1);
    expect(itemOverrideCount({ ...withAction, labor_hours_override: 3, rationale: "Dent.\n\nAgent feedback: note" }, ai)).toBe(3);
  });
});
describe("photo deletion", () => {
  const c = { photos: ["x/a.jpg", "x/b.jpg", "x/c.jpg"], ai_result: { analyzed_photos: ["x/a.jpg"], photo_quality: [] } , line_items: [{ photo_index: 2 }], ai_line_items: [] } as never as import("./claims").Claim;
  it("only allows unanalyzed, unused photos", () => {
    expect(canDelPhoto(c, 0)).toBe(false);
    expect(canDelPhoto(c, 1)).toBe(true);
    expect(canDelPhoto(c, 2)).toBe(false);
  });
  it("shifts later photo positions", () => {
    const r = rmPhoto(c, 1);
    expect(r.photos).toEqual(["x/a.jpg", "x/c.jpg"]);
    expect(r.line_items[0]!.photo_index).toBe(1);
  });
});

import { revertItemToAi, canRevertItem } from "./claims";
describe("revert line item to the AI assessment", () => {
  const ai: LineItem = { ...item, rationale: "Scratch on bumper." };
  it("undoes every overridden section at once, including agent feedback", () => {
    let o = applyManualOverride(ai, { action: "replace" }, "Cracked", ai);
    o = applyManualOverride(o, { severity: "severe", labor_hours_override: 4, price_override: 900 }, "Shop quote", ai);
    o = applyManualOverride(o, { rationale: joinRationale(ai.rationale, "Seen in person") }, "Agent feedback added", ai);
    const back = revertItemToAi(o, ai);
    expect(hasOverrides(back, ai)).toBe(false);
    expect(back).toMatchObject({ action: "repair", severity: "minor", rationale: "Scratch on bumper.", price_override: null, labor_hours_override: null });
    expect(estimateTotal(table, [back])).toBe(calcPrice(table, ai));
  });
  it("also clears the accept/reject decision so the agent can choose again", () => {
    const rejected = reviewLineItem(applyManualOverride(ai, { severity: "severe" }, "Deep", ai), "rejected", "Pre-existing");
    const back = revertItemToAi(rejected, ai);
    expect(back.review_decision).toBeUndefined();
    expect(back.rejection_reason).toBeNull();
    expect(back.severity).toBe("minor");
    expect(rowTone(back, ai)).toBe("none");
  });
  it("revert button shows once an AI item has a change or a decision, never on agent-added items", () => {
    expect(canRevertItem(ai, ai)).toBe(false);
    expect(canRevertItem(reviewLineItem(ai, "accepted"), ai)).toBe(true);
    expect(canRevertItem(applyManualOverride(ai, { action: "replace" }, "Cracked", ai), ai)).toBe(true);
    expect(canRevertItem({ ...ai, confidence: null, review_decision: "accepted" }, ai)).toBe(false);
  });
  it("agent-added items can't be reverted", () => {
    expect(() => revertItemToAi({ ...ai, confidence: null }, ai)).toThrow();
  });
});

import { newPhotoPositions, mergeAddedPhotoResult, type AiResult } from "./claims";
describe("analyzing only newly added photos", () => {
  const prev: AiResult = {
    photo_quality: [{ photo_index: 0, usable: true, issue: null }],
    can_assess: true, requires_inspection: false, requires_inspection_reason: null,
    analyzed_photos: ["c/a.jpg"],
  };
  it("only the photo the AI hasn't seen yet is sent", () => {
    expect(newPhotoPositions(prev, ["c/a.jpg", "c/b.jpg"])).toEqual([1]);
  });
  it("a fresh full analysis is needed when there's no earlier result or an analyzed photo was replaced", () => {
    expect(newPhotoPositions(null, ["c/a.jpg"])).toBeNull();
    expect(newPhotoPositions(prev, ["c/x.jpg", "c/b.jpg"])).toBeNull();
  });
  it("merging keeps the earlier photo's notes and marks the new photo as agent-added and deletable", () => {
    const merged = mergeAddedPhotoResult(prev, { photo_quality: [{ photo_index: 1, usable: true, issue: null }], can_assess: true, requires_inspection: false, requires_inspection_reason: null }, ["c/a.jpg", "c/b.jpg"], ["c/b.jpg"]);
    expect(merged.analyzed_photos).toEqual(["c/a.jpg", "c/b.jpg"]);
    expect(merged.photo_quality.map((q) => q.photo_index)).toEqual([0, 1]);
    expect(merged.added_photos).toEqual(["c/b.jpg"]);
    const claim = { photos: ["c/a.jpg", "c/b.jpg"], ai_result: merged, line_items: [{ ...item, id: "n", photo_index: 1 }], ai_line_items: [{ ...item, id: "n", photo_index: 1 }] };
    expect(canDelPhoto(claim, 1)).toBe(true);
    expect(canDelPhoto(claim, 0)).toBe(false);
    const after = rmPhoto(claim, 1);
    expect(after.line_items).toEqual([]);
    expect(after.ai_result?.analyzed_photos).toEqual(["c/a.jpg"]);
  });
});
