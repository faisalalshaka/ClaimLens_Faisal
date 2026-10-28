import { reviewHours, type Claim } from "./claims";

export type MilestoneKey = "opened" | "photos" | "ai" | "review" | "senior";
export type MilestoneState = "done" | "active" | "upcoming" | "returned";
export type Milestone = { key: MilestoneKey; label: string; at: string | null; state: MilestoneState; note: string | null };

/**
 * Demo-only history per scenario (made up). The claim's created_at is when the customer's photos landed;
 * intakeHours is how long before that the claim was opened, aiSeconds the AI analysis time,
 * and the optional review fields fill in work done before the demo starts.
 */
type DemoTimeline = { intakeHours: number; aiSeconds: number; reviewMin?: number; submittedAfterHours?: number; returnedAfterHours?: number };
export const DEMO_TIMELINES: Record<string, DemoTimeline> = {
  "CLM-24-10421": { intakeHours: 14.2, aiSeconds: 31 },
  "CLM-24-10422": { intakeHours: 26.5, aiSeconds: 44 },
  "CLM-24-10423": { intakeHours: 6.8, aiSeconds: 52 },
  "CLM-24-10424": { intakeHours: 121.3, aiSeconds: 38 }, // ~5 days for the customer to upload
  "CLM-24-10425": { intakeHours: 168.4, aiSeconds: 27 }, // ~7 days for the customer to upload
  "CLM-24-10426": { intakeHours: 19.6, aiSeconds: 35, reviewMin: 7.4, submittedAfterHours: 1.5, returnedAfterHours: 3.2 },
};

const plus = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();
const H = 3_600_000;
const hoursBetween = (a: string | null, b: string | null) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / H : null);

export function fmtDuration(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return "—";
  const s = hours * 3600;
  if (s < 60) return `${Math.max(1, Math.round(s))}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

/** Key timestamps for a claim: live data wins, demo history fills the gaps. */
export function claimTimes(c: Claim) {
  const demo = DEMO_TIMELINES[c.id];
  const hasPhotos = c.photos.some(Boolean);
  const opened = demo ? plus(c.created_at, -demo.intakeHours * H) : c.created_at;
  const photos = demo ? c.created_at : hasPhotos ? (c.ai_result ? (c.review_started_at ?? c.submitted_at ?? null) : null) : null;
  const ai = c.ai_result && photos ? plus(photos, (demo?.aiSeconds ?? 30) * 1000) : null;
  const demoSubmit = demo?.submittedAfterHours != null && ai ? plus(ai, demo.submittedAfterHours * H) : null;
  const submitted = c.submitted_at ?? demoSubmit;
  const reviewStart = c.review_started_at ?? (demo?.reviewMin != null && demoSubmit ? plus(demoSubmit, -demo.reviewMin * 60_000) : null);
  const returned = c.status === "Returned to agent" && demo?.returnedAfterHours != null && submitted ? plus(submitted, demo.returnedAfterHours * H) : null;
  const decided = c.approved_at ?? returned;
  return { opened, photos, ai, reviewStart, submitted, decided };
}

export function claimTimeline(c: Claim): Milestone[] {
  const t = claimTimes(c);
  const awaiting = c.status === "Awaiting customer photos";
  const intake = hoursBetween(t.opened, t.photos);
  const touch = c.submitted_at ? reviewHours(c) : hoursBetween(t.reviewStart, t.submitted);
  const senior = hoursBetween(t.submitted, t.decided);
  const st = (done: boolean, active: boolean): MilestoneState => (done ? "done" : active ? "active" : "upcoming");
  return [
    { key: "opened", label: "Claim opened", at: t.opened, state: "done", note: "Customer notified" },
    { key: "photos", label: "Customer photos", at: t.photos, state: st(!!t.photos && !awaiting, awaiting || !t.photos), note: awaiting ? "Waiting on customer" : intake != null ? `${fmtDuration(intake)} customer intake` : null },
    { key: "ai", label: "AI analysis", at: t.ai, state: st(!!t.ai, !!t.photos && !t.ai), note: t.ai && t.photos ? `${fmtDuration(hoursBetween(t.photos, t.ai))} vision analysis` : null },
    { key: "review", label: "Agent review", at: t.submitted, state: st(!!t.submitted && c.status !== "Returned to agent" && c.status !== "Ready for agent review", !!t.ai && !awaiting), note: c.status === "Returned to agent" ? (c.active_review_seconds ? `Revising · ${fmtDuration(c.active_review_seconds / 3600)} so far` : "Revising after return") : touch != null ? `${fmtDuration(touch)} active time` : t.ai && !awaiting ? (c.active_review_seconds ? `In review · ${fmtDuration(c.active_review_seconds / 3600)} so far` : "In review") : null },
    {
      key: "senior",
      label: "Senior decision",
      at: t.decided,
      state: c.status === "Approved" ? "done" : c.status === "Returned to agent" ? "returned" : c.status === "Submitted to senior" ? "active" : "upcoming",
      note: c.status === "Approved" ? `Approved in ${fmtDuration(senior)}` : c.status === "Returned to agent" ? `Returned after ${fmtDuration(senior)}` : c.status === "Submitted to senior" ? "In approval queue" : null,
    },
  ];
}

/** Total turnaround (claim opened → sent to senior) and its customer-intake part, in hours. Null until submitted. */
export function turnaround(c: Claim): { total: number; intake: number } | null {
  const t = claimTimes(c);
  const total = hoursBetween(t.opened, t.submitted);
  const intake = hoursBetween(t.opened, t.photos);
  return total != null && total >= 0 && intake != null ? { total, intake } : null;
}
