import { turnaround } from "./timeline";
export const PARTS = [
  "front bumper", "rear bumper", "hood", "trunk/tailgate", "roof",
  "front left fender", "front right fender", "front left door", "front right door",
  "rear left door", "rear right door", "left quarter panel", "right quarter panel",
  "left headlight", "right headlight", "left taillight", "right taillight",
  "windshield", "left side mirror", "right side mirror", "grille",
] as const;
export const DAMAGE_TYPES = ["scratch", "dent", "crack", "broken/shattered", "structural deformation"] as const;
export const SEVERITIES = ["minor", "moderate", "severe"] as const;
export const ACTIONS = ["repair", "replace"] as const;
export const PHOTO_ISSUES = ["blurry", "too dark", "vehicle not visible", "no damage visible"] as const;

export const STATUSES = [
  "Ready for agent review",
  "Awaiting customer photos",
  "Submitted to senior",
  "Returned to agent",
  "Approved",
] as const;

export type Part = (typeof PARTS)[number];
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Action = (typeof ACTIONS)[number];
export type Status = (typeof STATUSES)[number];

/** Standard body-shop labor rate in USD per hour, applied to repair_costs.labor_hours. */
export const LABOR_RATE = 50;
export const LOW_CONFIDENCE = 0.8;

export type LineItem = {
  id: string;
  photo_index: number;
  part: Part;
  damage_type: DamageType;
  severity: Severity;
  action: Action;
  confidence: number | null; // null = added by agent
  bbox: [number, number, number, number];
  rationale: string;
  price_override?: number | null;
  /** Agent-edited labor hours; null/undefined = standard hours from the cost table. */
  labor_hours_override?: number | null;
  override_reason?: string | null;
  review_decision?: "accepted" | "rejected";
  rejection_reason?: string | null;
  overridden_fields?: string[];
  override_reasons?: Record<string, string>;
  manual_override_reason?: string | null;
  /** Senior Adjuster's revision request on this item; resolved once the agent resubmits (kept for the record). */
  senior_flag?: SeniorFlag | null;
};

export type SeniorFlag = { note: string; at: string; resolved: boolean };
export type VehicleMismatch = { path: string; reason: string };

/**
 * Warning text for photos showing a different vehicle, naming each by its current number on the claim (P1, P2…),
 * so it stays right after photos are added or removed. Null when no photo on the claim is mismatched.
 */
export function vehicleMismatchText(ai: Pick<AiResult, "vehicle_mismatch" | "vehicle_mismatch_reason" | "vehicle_mismatches"> | null | undefined, photos: (string | null)[]): string | null {
  if (!ai) return null;
  if (ai.vehicle_mismatches) {
    const parts = ai.vehicle_mismatches
      .map((m) => ({ n: photos.indexOf(m.path) + 1, reason: m.reason.replace(/^\s*(the\s+)?photo(\s+\d+)?\s*/i, "").replace(/\.+$/, "") }))
      .filter((m) => m.n > 0)
      .sort((a, b) => a.n - b.n)
      .map((m) => `Photo ${m.n} ${m.reason.charAt(0).toLowerCase()}${m.reason.slice(1)}`);
    return parts.length ? parts.join("; ") : null;
  }
  return ai.vehicle_mismatch ? (ai.vehicle_mismatch_reason ?? "A photo appears to show a different vehicle than the insured one").replace(/\.+$/, "") : null;
}

export type PhotoQuality = { photo_index: number; usable: boolean; issue: string | null };
export type AiResult = {
  photo_quality: PhotoQuality[];
  can_assess: boolean;
  requires_inspection: boolean;
  requires_inspection_reason: string | null;
  /** True when the photos show damage to a different area than the customer's accident description. */
  narrative_mismatch?: boolean;
  narrative_mismatch_reason?: string | null;
  /** Photo shows a different vehicle than the insured one or than the other photos on the claim. */
  vehicle_mismatch?: boolean;
  vehicle_mismatch_reason?: string | null;
  /** Each photo (by file path) the AI judged to show a different vehicle; the photo number is worked out on display. */
  vehicle_mismatches?: VehicleMismatch[];
  /** Photo files the AI looked at for this result, in order; same photos → the saved result is reused. */
  analyzed_photos?: string[];
  /** Photos the agent added after the first analysis; only these (and their AI line items) may be removed. */
  added_photos?: string[];
};

export type Claim = {
  id: string;
  policy_number: string;
  policyholder: string;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  accident_date: string;
  description: string;
  photos: (string | null)[];
  status: Status;
  ai_result: AiResult | null;
  ai_line_items: LineItem[];
  line_items: LineItem[];
  agent_notes: string;
  rejection_reason: string | null;
  photo_request_reason: string | null;
  approved_at: string | null;
  created_at: string;
  assigned_agent?: string;
  submitted_at?: string | null;
  /** When the agent opened the claim for its current review cycle; cleared when it leaves the agent's hands. */
  review_started_at?: string | null;
  /** Accumulated seconds the agent actually had this claim open (pauses while away). */
  active_review_seconds?: number | null;
};

export type RepairCost = {
  part: string;
  action: string;
  severity: string;
  parts_cost: number;
  labor_hours: number;
  paint_materials_cost: number;
};

export type CostTable = Map<string, RepairCost>;

export const costKey = (part: string, action: string, severity: string) => `${part}|${action}|${severity}`;

export function buildCostTable(rows: RepairCost[]): CostTable {
  const m: CostTable = new Map();
  for (const r of rows)
    m.set(costKey(r.part, r.action, r.severity), {
      ...r,
      parts_cost: Number(r.parts_cost),
      labor_hours: Number(r.labor_hours),
      paint_materials_cost: Number(r.paint_materials_cost),
    });
  return m;
}

/** Standard line total from the cost table: parts + labor_hours × LABOR_RATE + paint/materials. */
export function calcPrice(table: CostTable, item: Pick<LineItem, "part" | "action" | "severity">): number {
  const r = table.get(costKey(item.part, item.action, item.severity));
  if (!r) return 0;
  return round2(r.parts_cost + r.labor_hours * LABOR_RATE + r.paint_materials_cost);
}

/** Calculated Parts Price (parts + paint/materials, no labor) from the cost table. */
export function calcPartsPrice(table: CostTable, item: Pick<LineItem, "part" | "action" | "severity">): number {
  const r = table.get(costKey(item.part, item.action, item.severity));
  return r ? round2(r.parts_cost + r.paint_materials_cost) : 0;
}

/** Parts Price used for the estimate: the agent's price override if set, otherwise the calculated parts price. */
export function partsPrice(table: CostTable, item: LineItem): number {
  return item.price_override != null ? item.price_override : calcPartsPrice(table, item);
}

/** Standard labor hours for a line item from the repair cost table; null when the combination isn't priced. */
export function laborHours(table: CostTable, item: Pick<LineItem, "part" | "action" | "severity">): number | null {
  const r = table.get(costKey(item.part, item.action, item.severity));
  return r ? r.labor_hours : null;
}

/** Labor hours used for the estimate: the agent's edited hours if set, otherwise the standard hours. */
export function finalLaborHours(table: CostTable, item: LineItem): number | null {
  return item.labor_hours_override != null ? item.labor_hours_override : laborHours(table, item);
}

/** Labor hours shown with one decimal ("2.0 h"). */
export const fmtHours = (h: number | null) => (h == null ? "—" : `${h.toFixed(1)} h`);

/** Parses typed labor hours like "2" or "2.5"; rounds to one decimal; null when not a valid non-negative number. */
export function parseHours(text: string): number | null {
  const clean = text.replace(/[h\s]/gi, "");
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(clean)) return null;
  const v = Math.round(Number(clean) * 10) / 10;
  return v > 999 ? null : v;
}

/** Breakdown tooltip for the Parts Price cell. */
export function priceBreakdown(table: CostTable, item: Pick<LineItem, "part" | "action" | "severity">): string | null {
  const r = table.get(costKey(item.part, item.action, item.severity));
  if (!r) return null;
  return `Parts ${fmtUSD(r.parts_cost)} + Paint & materials ${fmtUSD(r.paint_materials_cost)}`;
}

/** Full line price: Parts Price + labor hours × LABOR_RATE. */
export function finalPrice(table: CostTable, item: LineItem): number {
  return round2(partsPrice(table, item) + (finalLaborHours(table, item) ?? 0) * LABOR_RATE);
}

const payable = (items: LineItem[]) => items.filter((i) => i.review_decision !== "rejected");

/** Total labor hours across payable (non-rejected) items. */
export function totalLaborHours(table: CostTable, items: LineItem[]): number {
  return Math.round(payable(items).reduce((s, i) => s + (finalLaborHours(table, i) ?? 0), 0) * 10) / 10;
}

/** Total labor cost across payable items (hours × LABOR_RATE). */
export function laborTotal(table: CostTable, items: LineItem[]): number {
  return round2(payable(items).reduce((s, i) => s + (finalLaborHours(table, i) ?? 0) * LABOR_RATE, 0));
}

/** Total parts price across payable items (labor excluded). */
export function partsTotal(table: CostTable, items: LineItem[]): number {
  return round2(payable(items).reduce((s, i) => s + partsPrice(table, i), 0));
}

export function estimateTotal(table: CostTable, items: LineItem[]): number {
  return round2(payable(items).reduce((s, i) => s + finalPrice(table, i), 0));
}

const OVERRIDABLE = ["part", "damage_type", "severity", "action", "price_override", "labor_hours_override", "rationale"];
/** Fields that store an agent value on top of a calculated one (null = calculated); setting them at all is an override. */
const CALC_FIELDS = ["price_override", "labor_hours_override"];
const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** True when every field in the patch puts the item back to the original AI assessment. */
export function revertsToOriginal(patch: Partial<LineItem>, original: LineItem | undefined): boolean {
  if (!original) return false;
  const fields = Object.keys(patch).filter((f) => OVERRIDABLE.includes(f));
  return fields.length > 0 && fields.every((f) => sameValue(patch[f as keyof LineItem], original[f as keyof LineItem]));
}

/**
 * Apply a manual change. Fields that differ from the original AI item are marked overridden with the reason;
 * fields set back to the original AI value are un-marked (no reason needed).
 */
export function applyManualOverride(item: LineItem, patch: Partial<LineItem>, reason: string, original?: LineItem): LineItem {
  if (isAgentAdded(item)) return editAgentItem(item, patch);
  const why = reason.trim();
  const fields = Object.keys(patch).filter((field) => OVERRIDABLE.includes(field));
  const reverted = original ? fields.filter((f) => sameValue(patch[f as keyof LineItem], original[f as keyof LineItem])) : [];
  const overridden = fields.filter((f) => !reverted.includes(f));
  if (overridden.length && !why) throw new Error("Override reason is required.");
  const override_reasons = { ...(item.override_reasons ?? {}) };
  for (const f of reverted) delete override_reasons[f];
  for (const f of overridden) override_reasons[f] = why;
  const overridden_fields = [...new Set([...(item.overridden_fields ?? []), ...overridden])].filter((f) => !reverted.includes(f));
  const next: LineItem = { ...item, ...patch, overridden_fields, override_reasons };
  if (overridden.includes("price_override")) next.override_reason = why;
  if (reverted.includes("price_override")) { next.price_override = null; next.override_reason = null; }
  if (reverted.includes("labor_hours_override")) next.labor_hours_override = null;
  next.manual_override_reason = overridden.length ? why : overridden_fields.length ? item.manual_override_reason ?? null : null;
  return next;
}

/** Line items the agent entered by hand (not AI output). */
export const isAgentAdded = (item: Pick<LineItem, "confidence">) => item.confidence == null;

/** Agent-added items are entirely manual, so editing them is never an override and needs no reason. */
export function editAgentItem(item: LineItem, patch: Partial<LineItem>): LineItem {
  return { ...item, ...patch, overridden_fields: [], override_reasons: {}, override_reason: null, manual_override_reason: null };
}

/**
 * One-click undo: put every overridable section (Part, Damage, Severity, Action, Labor, Parts Price, Rationale
 * incl. agent feedback) back to the original AI assessment, clear all override marks, and clear the
 * Accept/Reject decision (and rejection reason) so the agent reviews it fresh. Photo and drawn box are kept.
 */
export function revertItemToAi(item: LineItem, original: LineItem): LineItem {
  if (isAgentAdded(item)) throw new Error("Agent-added line items have no AI assessment to revert to.");
  const { review_decision: _decision, ...rest } = item;
  return {
    ...rest,
    part: original.part, damage_type: original.damage_type, severity: original.severity, action: original.action,
    rationale: original.rationale,
    price_override: null, labor_hours_override: null,
    overridden_fields: [], override_reasons: {}, override_reason: null, manual_override_reason: null,
    rejection_reason: null,
  };
}

/** The revert button shows on an AI line item once it has any change or an Accept/Reject decision. */
export function canRevertItem(item: LineItem, original: LineItem | undefined): boolean {
  return !!original && !isAgentAdded(item) && (hasOverrides(item, original) || !!item.review_decision);
}

/**
 * True when a field is overridden: either recorded as overridden, or (when the original AI item is known)
 * its value differs from the AI assessment. A set price_override always counts as an override.
 */
export function isFieldOverridden(item: LineItem, field: string, original?: LineItem): boolean {
  if (isAgentAdded(item)) return false;
  if (CALC_FIELDS.includes(field)) return item[field as keyof LineItem] != null;
  if (item.overridden_fields?.includes(field)) return true;
  if (!original) return false;
  return !sameValue(item[field as keyof LineItem], original[field as keyof LineItem]);
}

/** Reason recorded for a specific overridden field, or null if that field was not overridden. */
export function fieldOverrideReason(item: LineItem, field: string, original?: LineItem): string | null {
  if (!isFieldOverridden(item, field, original)) return null;
  const recorded = item.override_reasons?.[field];
  if (recorded != null) return recorded;
  if (field === "price_override" && item.override_reason) return item.override_reason;
  return item.overridden_fields?.includes(field) ? item.manual_override_reason ?? "" : "";
}

/** Override reasons in the line-item column order, shown as "Damage: …" lines in the rationale's Agent feedback. */
export const OVERRIDE_COMMENT_FIELDS = [
  ["part", "Part"], ["damage_type", "Damage"], ["severity", "Severity"], ["action", "Action"],
  ["labor_hours_override", "Labor"], ["price_override", "Parts Price"],
] as const;

export function overrideComments(item: LineItem, original?: LineItem): { field: string; label: string; reason: string }[] {
  return OVERRIDE_COMMENT_FIELDS.flatMap(([field, label]) => {
    const reason = fieldOverrideReason(item, field, original)?.trim();
    return reason ? [{ field, label, reason }] : [];
  });
}

/** True when any field of the item is overridden relative to the AI assessment. */
export function hasOverrides(item: LineItem, original?: LineItem): boolean {
  return OVERRIDABLE.some((f) => isFieldOverridden(item, f, original));
}

export type RowTone = "overridden" | "added" | "accepted" | "rejected" | "none";

/**
 * Row color for a line item. Overrides win (yellow); otherwise agent-added items are blue;
 * otherwise an accepted item is green and a rejected item is red.
 */
export function rowTone(item: LineItem, original?: LineItem): RowTone {
  if (hasOverrides(item, original)) return "overridden";
  if (item.confidence == null) return "added";
  if (item.review_decision === "accepted") return "accepted";
  if (item.review_decision === "rejected") return "rejected";
  return "none";
}

export function reviewLineItem(item: LineItem, decision: "accepted" | "rejected", reason = ""): LineItem {
  if (decision === "rejected" && !reason.trim()) throw new Error("Rejection reason is required.");
  return { ...item, review_decision: decision, rejection_reason: decision === "rejected" ? reason.trim() : null };
}

/* ---------- Senior revision flags ---------- */

/** Senior's draft notes while reviewing, keyed by line-item ID (a key present = item flagged). */
export type SeniorFlagDrafts = Record<string, string>;

/** Approve is only possible when the senior has no line item flagged for revision. */
export function canSeniorApprove(flags: SeniorFlagDrafts): boolean {
  return Object.keys(flags).length === 0;
}

/** Return to the junior needs at least one flagged item, and every flagged item needs a note. */
export function canReturnToAgent(flags: SeniorFlagDrafts): boolean {
  const notes = Object.values(flags);
  return notes.length > 0 && notes.every((n) => n.trim().length > 0);
}

/**
 * Pin each senior note onto its line item (open, unresolved) and clear that item's Accept/Reject decision,
 * so the agent must re-decide it after reading the note. Field values and overrides are kept.
 * Unflagged items keep their decision and any earlier, resolved note.
 */
export function applySeniorFlags(items: LineItem[], flags: SeniorFlagDrafts, at = new Date().toISOString()): LineItem[] {
  if (!canReturnToAgent(flags)) throw new Error("Every flagged line item needs a note.");
  return items.map((i) => {
    if (!(i.id in flags)) return i;
    const { review_decision: _decision, ...rest } = i;
    return { ...rest, rejection_reason: null, senior_flag: { note: flags[i.id]!.trim(), at, resolved: false } };
  });
}

/** On resubmission the junior has worked through the notes: mark them resolved but keep them for the record. */
export function resolveSeniorFlags(items: LineItem[]): LineItem[] {
  return items.map((i) => (i.senior_flag && !i.senior_flag.resolved ? { ...i, senior_flag: { ...i.senior_flag, resolved: true } } : i));
}

export function openSeniorFlags(items: LineItem[]): LineItem[] {
  return items.filter((i) => i.senior_flag && !i.senior_flag.resolved);
}

/** Claim-level return reason summarising the flagged items, e.g. "2 line items flagged for revision: #1 Rear Bumper, #3 Hood". */
export function seniorReturnSummary(flagged: { n: number; part: string }[]): string {
  const list = flagged.map((f) => `#${f.n} ${f.part.replace(/\b\w/g, (c) => c.toUpperCase())}`).join(", ");
  return `${flagged.length} line item${flagged.length === 1 ? "" : "s"} flagged for revision: ${list}`;
}

/** Restoring line items to the AI assessment keeps the senior's notes on the same items. */
export function keepSeniorFlags(next: LineItem[], current: LineItem[]): LineItem[] {
  const flags = new Map(current.flatMap((i) => (i.senior_flag ? [[i.id, i.senior_flag] as const] : [])));
  return next.map((i) => {
    const flag = flags.get(i.id);
    return flag ? { ...i, senior_flag: flag } : i;
  });
}

/** Only items the agent added themselves can be deleted; AI line items are never deleted (reject them instead). */
export function canDeleteItem(item: LineItem, aiItems: LineItem[]): boolean {
  return item.confidence == null && !aiItems.some((a) => a.id === item.id);
}

export function deleteAgentItem(items: LineItem[], id: string, aiItems: LineItem[]): LineItem[] {
  const target = items.find((i) => i.id === id);
  if (!target || !canDeleteItem(target, aiItems)) throw new Error("Only agent-added line items can be deleted.");
  return items.filter((i) => i.id !== id);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** Amount with thousands commas and 2 decimals, no currency sign (for the editable price box). */
export const fmtAmount = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Parses a typed price like "1,000.56" or "$1000"; null when it isn't a valid non-negative amount. */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(clean)) return null;
  return round2(Number(clean));
}

export function isLowConfidence(i: LineItem) {
  return i.confidence != null && i.confidence < LOW_CONFIDENCE;
}

export function sortItems(items: LineItem[]) {
  return [...items].sort((a, b) => Number(isLowConfidence(b)) - Number(isLowConfidence(a)));
}

export type Flags = { lowConfidence: boolean; inspection: boolean; photoIssue: boolean; returned: boolean };

export function claimFlags(c: Claim): Flags {
  return {
    lowConfidence: c.line_items.some(isLowConfidence),
    inspection: !!c.ai_result?.requires_inspection,
    photoIssue: !!c.ai_result?.photo_quality.some((p) => !p.usable),
    returned: c.status === "Returned to agent",
  };
}

/** Demo happy-path claim (Dana Whitfield) always leads the junior queue so the walkthrough starts there. */
export const DEMO_FIRST_CLAIM = "CLM-24-10421";

export function sortJuniorQueue(claims: Claim[]) {
  const score = (c: Claim) => {
    if (c.id === DEMO_FIRST_CLAIM) return -1;
    const f = claimFlags(c);
    if (f.returned) return 0;
    if (f.lowConfidence || f.inspection || f.photoIssue) return 1;
    return 2;
  };
  return [...claims].sort((a, b) => score(a) - score(b) || a.created_at.localeCompare(b.created_at));
}

export function avgAiConfidence(claims: Claim[]): number | null {
  const vals = claims.flatMap((c) => c.ai_line_items.map((i) => i.confidence).filter((x): x is number => x != null));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export type Change =
  | { kind: "added"; item: LineItem }
  | { kind: "removed"; item: LineItem }
  | { kind: "decision"; item: LineItem; decision: "accepted" | "rejected"; reason: string }
  | { kind: "modified"; item: LineItem; fields: { field: string; from: string; to: string }[] }
  | { kind: "override"; item: LineItem; calculated: number; price: number; reason: string };

const EDITABLE: (keyof LineItem)[] = ["part", "damage_type", "severity", "action", "rationale"];

export function diffItems(table: CostTable, ai: LineItem[], current: LineItem[]): Change[] {
  const out: Change[] = [];
  const aiById = new Map(ai.map((i) => [i.id, i]));
  const curIds = new Set(current.map((i) => i.id));
  for (const item of current) {
    if (item.review_decision) out.push({ kind: "decision", item, decision: item.review_decision, reason: item.rejection_reason ?? "" });
    const orig = aiById.get(item.id);
    if (!orig) {
      out.push({ kind: "added", item });
    } else {
      const fields = EDITABLE.filter((f) => orig[f] !== item[f]).map((f) => ({
        field: f.replace("_", " "),
        from: String(orig[f]),
        to: String(item[f]),
      }));
      if (item.labor_hours_override != null)
        fields.push({ field: "labor", from: fmtHours(laborHours(table, item)), to: fmtHours(item.labor_hours_override) });
      if (fields.length) out.push({ kind: "modified", item, fields });
    }
    if (item.price_override != null && orig)
      out.push({
        kind: "override",
        item,
        calculated: calcPartsPrice(table, item),
        price: item.price_override,
        reason: item.override_reason ?? "",
      });
  }
  for (const item of ai) if (!curIds.has(item.id)) out.push({ kind: "removed", item });
  return out;
}

export function changedIds(changes: Change[]) {
  return new Set(changes.filter((c) => c.kind !== "removed").map((c) => c.item.id));
}

export const vehicleLabel = (c: Pick<Claim, "vehicle_year" | "vehicle_make" | "vehicle_model">) =>
  `${c.vehicle_year} ${c.vehicle_make} ${c.vehicle_model}`;

export const issueText = (issue: string | null) =>
  issue === "blurry" ? "too blurry to assess" : issue === "too dark" ? "too dark to assess" : issue ?? "unusable";

/** Message shown on a freshly created claim while the customer is asked for damage photos. */
export const INITIAL_PHOTO_REQUEST = "Claim created. Customer notified to upload photos of the damage.";

export type NewClaimInput = {
  policyholder: string;
  policy_number: string;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  accident_date: string;
  description: string;
};

/** A newly created claim always waits for the customer's photos before any AI analysis or review. */
export function newClaimRecord(input: NewClaimInput, id: string) {
  return {
    ...input,
    id,
    photos: [] as (string | null)[],
    status: "Awaiting customer photos" as Status,
    photo_request_reason: INITIAL_PHOTO_REQUEST,
    ai_result: null,
    ai_line_items: [] as LineItem[],
    line_items: [] as LineItem[],
  };
}

export function newClaimId(now = new Date(), rand = Math.random()) {
  return `CLM-${now.getFullYear().toString().slice(2)}-${Math.floor(10000 + rand * 89999)}`;
}

/** Adds uploaded photos: empty slots are filled first, then photos are appended with no upper limit. */
export function addPhotos(photos: (string | null)[], paths: string[]): (string | null)[] {
  const next = [...photos];
  for (const p of paths) {
    const slot = next.findIndex((x) => !x);
    if (slot === -1) next.push(p);
    else next[slot] = p;
  }
  return next;
}

/** Original photo positions of the uploaded photos, so AI results map back to the right photo. */
export function uploadedPhotoIndices(photos: (string | null)[]): number[] {
  return photos.flatMap((p, i) => (p ? [i] : []));
}

/** Photo formats the AI can read. Other formats are converted to JPEG on upload. */
export function isAiReadablePhoto(path: string) {
  return /\.(jpe?g|png|webp|gif)$/i.test(path);
}

/** Uploaded photos the AI can analyze, as positions in the claim's photo list. */
export function analyzablePhotoIndices(photos: (string | null)[]): number[] {
  return uploadedPhotoIndices(photos).filter((i) => isAiReadablePhoto(photos[i]!));
}

/** The AI-readable photo files a fresh analysis would look at, in claim order. */
export function analyzablePhotoPaths(photos: (string | null)[]): string[] {
  return analyzablePhotoIndices(photos).map((i) => photos[i]!);
}

/** True when the claim's photos are exactly the ones behind its saved AI result, so re-running must not change it. */
export function aiResultIsCurrent(ai: AiResult | null, photos: (string | null)[]): boolean {
  if (!ai?.analyzed_photos) return false;
  const now = analyzablePhotoPaths(photos);
  return now.length === ai.analyzed_photos.length && now.every((p, i) => p === ai.analyzed_photos![i]);
}

/**
 * Photo positions the AI hasn't looked at yet, or null when a fresh full analysis is needed
 * (no earlier result, or a photo it analyzed was replaced or removed).
 */
export function newPhotoPositions(ai: AiResult | null, photos: (string | null)[]): number[] | null {
  const seen = ai?.analyzed_photos;
  if (!seen?.length) return null;
  const now = analyzablePhotoPaths(photos);
  if (!seen.every((p) => now.includes(p))) return null;
  return analyzablePhotoIndices(photos).filter((i) => !seen.includes(photos[i]!));
}

/** Fold the AI's look at newly added photos into the saved result; earlier photos keep their quality notes. */
export function mergeAddedPhotoResult(
  prev: AiResult,
  add: Pick<AiResult, "photo_quality" | "can_assess" | "requires_inspection" | "requires_inspection_reason" | "narrative_mismatch" | "narrative_mismatch_reason" | "vehicle_mismatch" | "vehicle_mismatch_reason" | "vehicle_mismatches">,
  photos: (string | null)[],
  newPaths: string[],
): AiResult {
  const newPos = new Set(add.photo_quality.map((q) => q.photo_index));
  return {
    photo_quality: [...prev.photo_quality.filter((q) => !newPos.has(q.photo_index)), ...add.photo_quality].sort((a, b) => a.photo_index - b.photo_index),
    can_assess: prev.can_assess || add.can_assess,
    requires_inspection: prev.requires_inspection || add.requires_inspection,
    requires_inspection_reason: prev.requires_inspection_reason ?? add.requires_inspection_reason,
    narrative_mismatch: !!(prev.narrative_mismatch || add.narrative_mismatch),
    narrative_mismatch_reason: prev.narrative_mismatch_reason ?? add.narrative_mismatch_reason ?? null,
    vehicle_mismatch: !!(prev.vehicle_mismatch || add.vehicle_mismatch),
    vehicle_mismatch_reason: (prev.vehicle_mismatch ? prev.vehicle_mismatch_reason : null) ?? add.vehicle_mismatch_reason ?? null,
    vehicle_mismatches: [...(prev.vehicle_mismatches ?? []), ...(add.vehicle_mismatches ?? [])],
    analyzed_photos: analyzablePhotoPaths(photos),
    added_photos: [...new Set([...(prev.added_photos ?? []), ...newPaths])],
  };
}

/** Intake details the AI's description and vehicle checks depend on; editing any of them makes those checks stale. */
export function intakeContextChanged(
  before: Pick<Claim, "description" | "vehicle_year" | "vehicle_make" | "vehicle_model">,
  after: Pick<Claim, "description" | "vehicle_year" | "vehicle_make" | "vehicle_model">,
): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    norm(before.description) !== norm(after.description) ||
    Number(before.vehicle_year) !== Number(after.vehicle_year) ||
    norm(before.vehicle_make) !== norm(after.vehicle_make) ||
    norm(before.vehicle_model) !== norm(after.vehicle_model)
  );
}

/**
 * Replace the description and vehicle checks with a fresh look against the edited intake details. Everything
 * else the AI found (photo quality, inspection, line items) is kept, so the agent's review work is untouched.
 */
export function applyContextRecheck(
  prev: AiResult,
  check: { narrative_mismatch: boolean; narrative_mismatch_reason: string | null; vehicle_mismatches: VehicleMismatch[] },
): AiResult {
  return {
    ...prev,
    narrative_mismatch: check.narrative_mismatch,
    narrative_mismatch_reason: check.narrative_mismatch ? check.narrative_mismatch_reason : null,
    vehicle_mismatch: check.vehicle_mismatches.length > 0,
    vehicle_mismatch_reason: check.vehicle_mismatches[0]?.reason ?? null,
    vehicle_mismatches: check.vehicle_mismatches,
  };
}


/** Today's date as YYYY-MM-DD in the agent's local time zone. */
export function todayISO(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Accident dates cannot be in the future. */
export function isFutureDate(date: string, today = todayISO()) {
  return date > today;
}

// ---------- KPIs ----------
export type Kpis = {
  overrideRate: number | null; // overridden sections / (AI line items × 7 overridable sections)
  cleanAcceptance: number | null; // reviewed claims with every AI item accepted as-is
  avgTurnaroundHours: number | null; // agent opened claim for review → submitted to senior
  avgCycleHours: number | null; // claim opened → submitted to senior (includes customer wait)
  intakeShare: number | null; // share of cycle time spent waiting on customer photos
  escalationRate: number | null; // inspection required or returned by senior
  missedRate: number | null; // reviewed claims where the agent had to add ≥1 item the AI missed
};

const REVIEWED: Status[] = ["Submitted to senior", "Approved"];
const ratio = (n: number, d: number) => (d === 0 ? null : n / d);

/** The 7 sections of an AI line item counted toward the override rate. */
export const OVERRIDE_SECTIONS = ["part", "damage_type", "severity", "action", "labor_hours_override", "price_override", "rationale"] as const;

/**
 * Rationale counts only when the agent wrote their own feedback or changed the AI's text. Column override
 * reasons are stored separately (and already counted under their column), so they never count here.
 */
export function rationaleOverridden(item: LineItem, original?: LineItem): boolean {
  if (isAgentAdded(item)) return false;
  const { base, feedback } = splitRationale(item.rationale ?? "");
  if (feedback) return true;
  return !!original && base !== splitRationale(original.rationale ?? "").base;
}

/** Number of the 7 sections overridden on one AI line item. */
export function itemOverrideCount(item: LineItem, original?: LineItem): number {
  return OVERRIDE_SECTIONS.filter((f) => (f === "rationale" ? rationaleOverridden(item, original) : isFieldOverridden(item, f, original))).length;
}

/** Number of AI line-item sections overridden on a claim (any status). Agent-added items are not AI output, so they don't count. */
export function claimOverrideCount(c: Claim): number {
  return c.line_items
    .filter((i) => i.confidence != null)
    .reduce((n, i) => n + itemOverrideCount(i, c.ai_line_items.find((a) => a.id === i.id)), 0);
}

/** Photos the agent uploaded themselves (after the first AI analysis); only these may be removed. */
export function canDeletePhoto(c: Pick<Claim, "photos" | "ai_result" | "line_items" | "ai_line_items">, index: number): boolean {
  const p = c.photos[index];
  if (!p) return false;
  if (c.ai_result?.added_photos?.includes(p)) return true;
  if (c.ai_result?.analyzed_photos?.includes(p)) return false;
  return ![...c.line_items, ...c.ai_line_items].some((i) => i.photo_index === index);
}

/**
 * Remove an agent-uploaded photo, along with the line items found on it, and shift later photo positions down
 * so the remaining line items keep pointing at the right picture.
 */
export function removePhoto<T extends Pick<Claim, "photos" | "ai_result" | "line_items" | "ai_line_items">>(c: T, index: number) {
  const path = c.photos[index];
  const keep = (i: LineItem) => i.photo_index !== index;
  const shift = (i: LineItem) => (i.photo_index > index ? { ...i, photo_index: i.photo_index - 1 } : i);
  return {
    photos: c.photos.filter((_, k) => k !== index),
    line_items: c.line_items.filter(keep).map(shift),
    ai_line_items: c.ai_line_items.filter(keep).map(shift),
    ai_result: c.ai_result && {
      ...c.ai_result,
      ...(c.ai_result.analyzed_photos && { analyzed_photos: c.ai_result.analyzed_photos.filter((p) => p !== path) }),
      ...(c.ai_result.added_photos && { added_photos: c.ai_result.added_photos.filter((p) => p !== path) }),
      ...(c.ai_result.vehicle_mismatches && {
        vehicle_mismatches: c.ai_result.vehicle_mismatches.filter((m) => m.path !== path),
        vehicle_mismatch: c.ai_result.vehicle_mismatches.some((m) => m.path !== path),
      }),
      photo_quality: c.ai_result.photo_quality
        .filter((q) => q.photo_index !== index)
        .map((q) => (q.photo_index > index ? { ...q, photo_index: q.photo_index - 1 } : q)),
    },
  };
}

/**
 * Active touch time in hours for a submitted claim: the accumulated seconds the agent had it open
 * (paused while away). Falls back to review start → submit for claims recorded before the stopwatch existed.
 */
export function reviewHours(c: Pick<Claim, "review_started_at" | "submitted_at" | "active_review_seconds">): number | null {
  if (!c.submitted_at) return null;
  if (c.active_review_seconds && c.active_review_seconds > 0) return c.active_review_seconds / 3600;
  if (!c.review_started_at) return null;
  const h = (new Date(c.submitted_at).getTime() - new Date(c.review_started_at).getTime()) / 3_600_000;
  return Number.isFinite(h) && h >= 0 ? h : null;
}

export type OverrideSection = (typeof OVERRIDE_SECTIONS)[number];
export type SectionCounts = Record<OverrideSection, number>;
export const OVERRIDE_SECTION_LABELS: Record<OverrideSection, string> = {
  part: "Part", damage_type: "Damage", severity: "Severity", action: "Action",
  labor_hours_override: "Labor", price_override: "Parts price", rationale: "Rationale",
};
const emptySections = (): SectionCounts => Object.fromEntries(OVERRIDE_SECTIONS.map((s) => [s, 0])) as SectionCounts;

/** Raw counts behind the KPIs, so live claims and historical baselines can be summed before dividing. */
export type KpiCounts = {
  overridableFields: number; overriddenFields: number;
  /** Overrides per section; sums to overriddenFields. */
  sectionOverrides: SectionCounts;
  reviewedClaims: number; cleanClaims: number;
  submittedClaims: number; submitHours: number;
  analyzedClaims: number; escalatedClaims: number;
  missedClaims: number; missedItems: number;
  turnaroundClaims: number; turnaroundHours: number; intakeHours: number;
};

export const EMPTY_COUNTS: KpiCounts = {
  overridableFields: 0, overriddenFields: 0, sectionOverrides: emptySections(), reviewedClaims: 0, cleanClaims: 0,
  submittedClaims: 0, submitHours: 0, analyzedClaims: 0, escalatedClaims: 0,
  missedClaims: 0, missedItems: 0,
  turnaroundClaims: 0, turnaroundHours: 0, intakeHours: 0,
};

export function addCounts(a: KpiCounts, b: KpiCounts): KpiCounts {
  const out = { ...a, sectionOverrides: { ...a.sectionOverrides } };
  for (const k of Object.keys(b) as (keyof KpiCounts)[]) {
    if (k === "sectionOverrides") continue;
    out[k] += b[k];
  }
  for (const s of OVERRIDE_SECTIONS) out.sectionOverrides[s] += b.sectionOverrides?.[s] ?? 0;
  return out;
}

/** Per-section override rates (overrides ÷ AI line items), most-overridden first — shows where agents correct the model. */
export function overrideBreakdown(c: KpiCounts) {
  const aiItems = c.overridableFields / OVERRIDE_SECTIONS.length;
  return OVERRIDE_SECTIONS.map((s) => ({
    section: s,
    label: OVERRIDE_SECTION_LABELS[s],
    count: c.sectionOverrides[s],
    rate: ratio(c.sectionOverrides[s], aiItems),
    share: ratio(c.sectionOverrides[s], c.overriddenFields),
  })).sort((x, y) => y.count - x.count);
}

/** Which of the 7 sections were overridden on one AI line item. */
export function overriddenSections(item: LineItem, original?: LineItem): OverrideSection[] {
  return OVERRIDE_SECTIONS.filter((f) => (f === "rationale" ? rationaleOverridden(item, original) : isFieldOverridden(item, f, original)));
}

/** Status for claims auto-closed after 30 days of customer inactivity (CWOP); excluded from queue and KPIs until reopened. */
export const CLOSED_INACTIVE = "Closed – inactive";
export const isClosedInactive = (c: Pick<Claim, "status">) => (c.status as string) === CLOSED_INACTIVE;

/**
 * Every KPI counts only claims the agent has handed off (Submitted to senior or Approved). Drafts still in the
 * junior queue — including ones returned for revision — are work in progress and would make the numbers swing.
 */
export function kpiCounts(allClaims: Claim[]): KpiCounts {
  const claims = allClaims.filter((c) => !isClosedInactive(c));
  const reviewed = claims.filter((c) => REVIEWED.includes(c.status));
  const aiItemCount = reviewed.reduce((n, c) => n + c.line_items.filter((i) => i.confidence != null).length, 0);
  const overridden = reviewed.reduce((n, c) => n + claimOverrideCount(c), 0);
  const sectionOverrides = emptySections();
  for (const c of reviewed)
    for (const i of c.line_items)
      if (i.confidence != null)
        for (const s of overriddenSections(i, c.ai_line_items.find((a) => a.id === i.id))) sectionOverrides[s]++;
  const clean = reviewed.filter(
    (c) =>
      c.line_items.length > 0 &&
      c.line_items.every((i) => i.confidence != null && i.review_decision === "accepted" && !hasOverrides(i, c.ai_line_items.find((a) => a.id === i.id))),
  ).length;
  const times = reviewed.map(reviewHours).filter((h): h is number => h != null);
  const analyzed = claims.filter((c) => c.ai_result);
  const turns = reviewed.map(turnaround).filter((t): t is NonNullable<typeof t> => t != null);
  return {
    overridableFields: aiItemCount * OVERRIDE_SECTIONS.length,
    overriddenFields: overridden,
    sectionOverrides,
    reviewedClaims: reviewed.length,
    cleanClaims: clean,
    submittedClaims: times.length,
    submitHours: times.reduce((a, b) => a + b, 0),
    analyzedClaims: analyzed.length,
    escalatedClaims: analyzed.filter((c) => c.ai_result!.requires_inspection || c.status === "Returned to agent" || !!c.rejection_reason).length,
    missedClaims: reviewed.filter((c) => c.line_items.some((i) => i.confidence == null)).length,
    missedItems: reviewed.reduce((n, c) => n + c.line_items.filter((i) => i.confidence == null).length, 0),
    turnaroundClaims: turns.length,
    turnaroundHours: turns.reduce((a, t) => a + t.total, 0),
    intakeHours: turns.reduce((a, t) => a + t.intake, 0),
  };
}

export function kpisFromCounts(c: KpiCounts): Kpis {
  return {
    overrideRate: ratio(c.overriddenFields, c.overridableFields),
    cleanAcceptance: ratio(c.cleanClaims, c.reviewedClaims),
    avgTurnaroundHours: c.submittedClaims ? c.submitHours / c.submittedClaims : null,
    escalationRate: ratio(c.escalatedClaims, c.analyzedClaims),
    missedRate: ratio(c.missedClaims, c.reviewedClaims),
    avgCycleHours: c.turnaroundClaims ? c.turnaroundHours / c.turnaroundClaims : null,
    intakeShare: ratio(c.intakeHours, c.turnaroundHours),
  };
}

export function computeKpis(claims: Claim[]): Kpis {
  return kpisFromCounts(kpiCounts(claims));
}

/** Separator between the AI's rationale and the agent's own feedback inside one stored rationale string. */
export const AGENT_FEEDBACK_MARK = "\n\nAgent feedback: ";

/** Split a stored rationale into the AI's text and the agent's feedback (empty when none). */
export function splitRationale(rationale: string): { base: string; feedback: string } {
  const at = rationale.indexOf(AGENT_FEEDBACK_MARK);
  if (at < 0) return { base: rationale.trim(), feedback: "" };
  return { base: rationale.slice(0, at).trim(), feedback: rationale.slice(at + AGENT_FEEDBACK_MARK.length).trim() };
}

/** Combine the AI's text and the agent's feedback back into one stored rationale. */
export function joinRationale(base: string, feedback: string): string {
  const b = base.trim(), f = feedback.trim();
  return f ? `${b}${AGENT_FEEDBACK_MARK}${f}` : b;
}

/** Override reason recorded automatically when the agent only adds/edits their feedback — the note is its own justification. */
export const AGENT_FEEDBACK_REASON = "Agent feedback added";

/** True when a patch changes only the agent-feedback part of the rationale (the AI's text is untouched). */
export function isFeedbackOnlyChange(item: LineItem, patch: Partial<LineItem>): boolean {
  const keys = Object.keys(patch);
  if (keys.length !== 1 || keys[0] !== "rationale" || patch.rationale == null) return false;
  return splitRationale(patch.rationale).base === splitRationale(item.rationale ?? "").base;
}

export type TextSegment = { text: string; added: boolean };

/**
 * Word-level diff of an edited rationale against the AI's original: returns the current text split into
 * segments, with the words the agent typed (not in the original) marked as added. Removed words aren't shown.
 */
export function addedTextSegments(original: string, current: string): TextSegment[] {
  const a = original.split(/(\s+)/).filter(Boolean);
  const b = current.split(/(\s+)/).filter(Boolean);
  const w = b.length + 1;
  const lcs = new Array<number>((a.length + 1) * w).fill(0);
  const L = (i: number, j: number) => lcs[i * w + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i * w + j] = a[i] === b[j] ? L(i + 1, j + 1) + 1 : Math.max(L(i + 1, j), L(i, j + 1));
  const raw: TextSegment[] = [];
  let i = 0, j = 0;
  while (j < b.length) {
    const tok = b[j] ?? "";
    if (i < a.length && a[i] === tok) { raw.push({ text: tok, added: false }); i++; j++; }
    else if (i < a.length && L(i + 1, j) >= L(i, j + 1)) i++;
    else { raw.push({ text: tok, added: /\S/.test(tok) }); j++; }
  }
  // Whitespace between two added words belongs to the added phrase; then merge neighbours.
  const out: TextSegment[] = [];
  raw.forEach((seg, k) => {
    const gap = !/\S/.test(seg.text) && !!raw[k - 1]?.added && !!raw[k + 1]?.added;
    const added = seg.added || gap;
    const last = out[out.length - 1];
    if (last && last.added === added) last.text += seg.text;
    else out.push({ text: seg.text, added });
  });
  return out;
}
