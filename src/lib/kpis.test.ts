import { describe, expect, it } from "vitest";
import { claimOverrideCount, computeKpis, kpiCounts, type Claim, type LineItem } from "./claims";
const item = (id: string, extra: Partial<LineItem> = {}): LineItem => ({ id, photo_index: 0, part: "hood", damage_type: "dent", severity: "minor", action: "repair", confidence: 0.9, bbox: [0,0,1,1], rationale: "r", ...extra });
const claim = (extra: Partial<Claim>): Claim => ({ id: "c", policy_number: "p", policyholder: "x", vehicle_year: 2020, vehicle_make: "a", vehicle_model: "b", accident_date: "2026-01-01", description: "", photos: [], status: "Approved", ai_result: { photo_quality: [{ photo_index: 0, usable: true, issue: null }], can_assess: true, requires_inspection: false, requires_inspection_reason: null }, ai_line_items: [item("1"), item("2")], line_items: [item("1", { review_decision: "accepted" }), item("2", { review_decision: "accepted" })], agent_notes: "", rejection_reason: null, photo_request_reason: null, approved_at: null, created_at: "2026-01-01T00:00:00Z", ...extra });
describe("computeKpis", () => {
  it("override rate = overridden sections / (AI items x 7) on submitted claims", () => {
    const c = claim({ status: "Submitted to senior", line_items: [item("1", { action: "replace" }), item("2", { price_override: 420 })] });
    expect(claimOverrideCount(c)).toBe(2);
    expect(computeKpis([c]).overrideRate).toBe(2 / 14);
  });
  it("claims still in the junior queue don't count toward any KPI until submitted", () => {
    const draft = (status: Claim["status"]) =>
      claim({ status, line_items: [item("1", { action: "replace" }), item("x", { confidence: null })], review_started_at: "2026-01-01T10:00:00Z", submitted_at: "2026-01-01T10:06:00Z" });
    for (const status of ["Ready for agent review", "Returned to agent"] as Claim["status"][]) {
      const counts = kpiCounts([draft(status)]);
      expect(counts.overridableFields).toBe(0);
      expect(counts.overriddenFields).toBe(0);
      expect(Object.values(counts.sectionOverrides).every((v) => v === 0)).toBe(true);
      expect(counts.reviewedClaims).toBe(0);
      expect(counts.missedClaims).toBe(0);
      expect(counts.submittedClaims).toBe(0);
      expect(counts.turnaroundClaims).toBe(0);
    }
    expect(kpiCounts([draft("Approved")]).overriddenFields).toBe(1);
  });
  it("rejections and agent-added items are not overrides", () => {
    const c = claim({ line_items: [item("1", { review_decision: "rejected" }), item("2"), item("x", { confidence: null })] });
    expect(claimOverrideCount(c)).toBe(0);
    expect(computeKpis([c]).overrideRate).toBe(0);
  });
  it("clean acceptance = claims accepted as-is", () => {
    expect(computeKpis([claim({}), claim({ line_items: [item("1", { review_decision: "rejected" })] })]).cleanAcceptance).toBe(0.5);
  });
  it("time to submit runs from the agent opening the claim, not from claim creation", () => {
    // created 3 days earlier; agent opened at 10:00 and submitted at 10:06 → 6 minutes
    const c = claim({ created_at: "2025-12-29T00:00:00Z", review_started_at: "2026-01-01T10:00:00Z", submitted_at: "2026-01-01T10:06:00Z" });
    expect(computeKpis([c]).avgTurnaroundHours! * 60).toBeCloseTo(6);
  });
  it("claims without a review start are not timed", () => {
    expect(computeKpis([claim({ submitted_at: "2026-01-01T03:00:00Z" })]).avgTurnaroundHours).toBeNull();
  });
  it("missed items rate counts reviewed claims with agent-added items", () => {
    const k = computeKpis([claim({}), claim({ line_items: [item("1", { review_decision: "accepted" }), item("x", { confidence: null }), item("y", { confidence: null })] })]);
    expect(k.missedRate).toBe(0.5);
  });
  it("escalation", () => {
    const k = computeKpis([claim({}), claim({ status: "Returned to agent", ai_result: { photo_quality: [{ photo_index: 0, usable: false, issue: "blurry" }], can_assess: true, requires_inspection: false, requires_inspection_reason: null } })]);
    expect(k.escalationRate).toBe(0.5);
  });
});

import { agentCounts, AGENT_HISTORY, JUNIOR_AGENT } from "./agents";
import { kpisFromCounts } from "./claims";
describe("agent KPIs", () => {
  it("junior dashboard and senior's Alex Rivera view use the same claims", () => {
    const c = claim({ assigned_agent: JUNIOR_AGENT, review_started_at: "2026-01-01T01:55:00Z", submitted_at: "2026-01-01T02:00:00Z" });
    expect(kpisFromCounts(agentCounts([c], JUNIOR_AGENT))).toEqual(computeKpis([c]));
  });
  it("Jordan Chen shows sample history: 12% override rate", () => {
    expect(Math.round(kpisFromCounts(agentCounts([], "Jordan Chen")).overrideRate! * 100)).toBe(12);
    expect(AGENT_HISTORY["Taylor Vance"]).toBeDefined();
  });
  it("sample agents average minutes, not hours: Jordan 6.5 min, Taylor 9.2 min", () => {
    expect(kpisFromCounts(agentCounts([], "Jordan Chen")).avgTurnaroundHours! * 60).toBeCloseTo(6.5);
    expect(kpisFromCounts(agentCounts([], "Taylor Vance")).avgTurnaroundHours! * 60).toBeCloseTo(9.2);
  });
  it("team view adds live claims to history", () => {
    const team = agentCounts([claim({})], null);
    expect(team.reviewedClaims).toBe(48 + 39 + 1);
  });
});

import { kpisFromCounts as k2, EMPTY_COUNTS as E2 } from "./claims";
import { describe as d2, it as i2, expect as e2 } from "vitest";
d2("total turnaround", () => {
  i2("averages claim-opened → submitted hours and reports customer-intake share", () => {
    const r = k2({ ...E2, turnaroundClaims: 2, turnaroundHours: 40, intakeHours: 36 });
    e2(r.avgCycleHours).toBe(20);
    e2(r.intakeShare).toBe(0.9);
  });
});

describe("active touch time", () => {
  it("uses accumulated active seconds, not the wall-clock gap, when the agent left and came back", async () => {
    const { reviewHours } = await import("./claims");
    const h = reviewHours({ review_started_at: "2026-01-01T09:00:00Z", submitted_at: "2026-01-01T10:05:00Z", active_review_seconds: 300 });
    expect(h! * 60).toBeCloseTo(5);
  });
});

describe("override breakdown by section", () => {
  it("counts each overridden section and sums to the overall override count", async () => {
    const { kpiCounts, overrideBreakdown } = await import("./claims");
    const c = claim({ status: "Submitted to senior", line_items: [item("1", { action: "replace", price_override: 420 }), item("2", { price_override: 300 })] });
    const counts = kpiCounts([c]);
    expect(counts.sectionOverrides.price_override).toBe(2);
    expect(counts.sectionOverrides.action).toBe(1);
    expect(counts.sectionOverrides.part).toBe(0);
    expect(Object.values(counts.sectionOverrides).reduce((a, b) => a + b, 0)).toBe(counts.overriddenFields);
    const top = overrideBreakdown(counts)[0]!;
    expect(top.section).toBe("price_override");
    expect(top.rate).toBe(1); // 2 of 2 AI line items
  });
  it("sample agents' section history sums to their override totals", () => {
    for (const h of Object.values(AGENT_HISTORY)) expect(Object.values(h.sectionOverrides).reduce((a, b) => a + b, 0)).toBe(h.overriddenFields);
  });
  it("team breakdown adds live sections to sample history", () => {
    expect(agentCounts([], null).sectionOverrides.severity).toBe(27 + 34);
  });
});
