import { addCounts, EMPTY_COUNTS, kpiCounts, type Claim, type KpiCounts } from "./claims";

/** The junior agent signed in on the demo's main dashboard; owns every live demo claim. */
export const JUNIOR_AGENT = "Alex Rivera";

/**
 * Sample past-month history for the other team members (demo only — they have no live claims).
 * Stored as raw counts so team totals stay correctly weighted.
 */
export const AGENT_HISTORY: Record<string, KpiCounts> = {
  "Jordan Chen": {
    overridableFields: 994, overriddenFields: 119, // 142 AI items × 7 sections, 12%
    sectionOverrides: { part: 8, damage_type: 14, severity: 27, action: 16, labor_hours_override: 19, price_override: 23, rationale: 12 }, // sums to 119
    reviewedClaims: 48, cleanClaims: 31,
    submittedClaims: 48, submitHours: 5.2, // avg 6.5 min per claim
    analyzedClaims: 52, escalatedClaims: 9,
    missedClaims: 4, missedItems: 5, // 8% of claims
    turnaroundClaims: 48, turnaroundHours: 1056, intakeHours: 984, // avg 22 h cycle, 93% customer intake
  },
  "Taylor Vance": {
    overridableFields: 826, overriddenFields: 157, // 118 AI items × 7 sections, 19%
    sectionOverrides: { part: 11, damage_type: 18, severity: 34, action: 22, labor_hours_override: 26, price_override: 31, rationale: 15 }, // sums to 157
    reviewedClaims: 39, cleanClaims: 21,
    submittedClaims: 39, submitHours: 5.98, // avg 9.2 min per claim
    analyzedClaims: 44, escalatedClaims: 10,
    missedClaims: 6, missedItems: 8, // 15% of claims
    turnaroundClaims: 39, turnaroundHours: 1131, intakeHours: 1022, // avg 29 h cycle, 90% customer intake
  },
};

export const agentOf = (c: Claim) => c.assigned_agent || JUNIOR_AGENT;

export function teamAgents(claims: Claim[]): string[] {
  return [...new Set([JUNIOR_AGENT, ...Object.keys(AGENT_HISTORY), ...claims.map(agentOf)])];
}

/** Live claim counts for one agent (or the whole team when agent is null) plus their sample history. */
export function agentCounts(claims: Claim[], agent: string | null): KpiCounts {
  const live = kpiCounts(agent ? claims.filter((c) => agentOf(c) === agent) : claims);
  const history = agent
    ? AGENT_HISTORY[agent] ?? EMPTY_COUNTS
    : Object.values(AGENT_HISTORY).reduce(addCounts, EMPTY_COUNTS);
  return addCounts(live, history);
}

/** View-only sample approved claims for the other agents (demo only), consistent with their AI performance history. */
export type SampleApproved = { id: string; agent: string; policyholder: string; vehicle: string; items: number; total: number; overrides: number; added: number; touchMin: number; approved_at: string };
const S = (id: string, agent: string, policyholder: string, vehicle: string, items: number, total: number, overrides: number, added: number, touchMin: number, approved_at: string): SampleApproved =>
  ({ id, agent, policyholder, vehicle, items, total, overrides, added, touchMin, approved_at });
export const SAMPLE_APPROVED: SampleApproved[] = [
  // Jordan Chen: mostly clean, ~6.5 min touch time, few misses
  S("CLM-24-10388", "Jordan Chen", "Grace Holloway", "2021 Honda Civic", 3, 2140, 0, 0, 5.8, "2026-10-19T16:42:00Z"),
  S("CLM-24-10379", "Jordan Chen", "Samuel Ortiz", "2020 Toyota RAV4", 4, 3615, 1, 0, 6.9, "2026-10-19T13:05:00Z"),
  S("CLM-24-10371", "Jordan Chen", "Nadia Petrov", "2023 Hyundai Tucson", 2, 1280, 0, 0, 4.7, "2026-10-18T18:20:00Z"),
  S("CLM-24-10362", "Jordan Chen", "Owen Fitzgerald", "2019 Ford F-150", 5, 4890, 2, 1, 8.4, "2026-10-18T10:11:00Z"),
  S("CLM-24-10354", "Jordan Chen", "Leah Kim", "2022 Mazda CX-5", 3, 2475, 0, 0, 6.2, "2026-10-17T15:37:00Z"),
  // Taylor Vance: more overrides (19%), more missed items (15%), ~9.2 min touch time
  S("CLM-24-10391", "Taylor Vance", "Victor Alvarez", "2018 Chevrolet Malibu", 4, 3980, 3, 1, 10.6, "2026-10-19T17:15:00Z"),
  S("CLM-24-10383", "Taylor Vance", "Hannah Brooks", "2022 Subaru Outback", 3, 2760, 2, 0, 8.1, "2026-10-19T11:48:00Z"),
  S("CLM-24-10374", "Taylor Vance", "Isaac Moreno", "2021 Nissan Altima", 5, 5310, 4, 1, 11.3, "2026-10-18T14:02:00Z"),
  S("CLM-24-10366", "Taylor Vance", "Chloe Bennett", "2020 Kia Sorento", 2, 1545, 1, 0, 7.4, "2026-10-17T19:26:00Z"),
];
