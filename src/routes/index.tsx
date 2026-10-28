import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { claimsQuery, costsQuery, updateClaim } from "@/lib/data";
import { useRole } from "@/lib/role";
import { claimFlags, claimOverrideCount, estimateTotal, isClosedInactive, sortJuniorQueue, STATUSES, vehicleLabel, type Claim, type Status } from "@/lib/claims";
import { readSettlement, settlementLabel, SETTLEMENT_RESET_EVENT, type SettlementLabel } from "@/lib/settlement";
import { Money, SettlementPill, StatusPill, statusCls, Tag } from "@/components/claim-ui";
import { NewClaimDialog } from "@/components/NewClaimDialog";
import { KpiPanel } from "@/components/KpiPanel";
import { agentCounts, agentOf, JUNIOR_AGENT, SAMPLE_APPROVED, teamAgents, type SampleApproved } from "@/lib/agents";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Claims queue · ClaimLens" },
      { name: "description", content: "Queue of auto damage claims awaiting review." },
      { property: "og:title", content: "Claims queue · ClaimLens" },
      { property: "og:description", content: "Queue of auto damage claims awaiting review." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: QueuePage,
});

const AGENT_ALL = "All junior agents";

function QueuePage() {
  const { role } = useRole();
  const { data: claims = [], isLoading } = useQuery(claimsQuery);
  const [status, setStatus] = useState<Status | "All">("All");
  const [agent, setAgent] = useState<string>(AGENT_ALL);
  const agents = teamAgents(claims);
  const kpiAgent = role === "junior" ? JUNIOR_AGENT : agent === AGENT_ALL ? null : agent;
  const scoped = kpiAgent ? claims.filter((c) => agentOf(c) === kpiAgent) : claims;

  const base =
    role === "junior"
      ? sortJuniorQueue(scoped.filter((c) => c.status !== "Approved" && !isClosedInactive(c)))
      : scoped.filter((c) => c.status === "Submitted to senior");
  const filterable = base;
  const list = status === "All" ? base : filterable.filter((c) => c.status === status);
  const statusOptions: Status[] = role === "junior" ? STATUSES.filter((s) => s !== "Approved") : [];
  const approvedList = scoped
    .filter((c) => c.status === "Approved")
    .sort((a, b) => (b.approved_at ?? "").localeCompare(a.approved_at ?? ""));
  const samples = role === "junior" ? [] : SAMPLE_APPROVED.filter((s) => !kpiAgent || s.agent === kpiAgent);
  const approvedCount = approvedList.length + samples.length;

  return (
    <main className="mx-auto max-w-[1400px] px-5 pb-16 pt-8">
      {role === "senior" && (
        <div className="mb-4 flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">Team performance</span>
          <select
            aria-label="Select agent"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="h-8 rounded-full border-0 bg-card px-3 text-[13px] font-medium shadow-card focus:outline-none focus:ring-[3px] focus:ring-ring/25"
          >
            <option>{AGENT_ALL}</option>
            {agents.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
      )}
      <KpiPanel
        counts={agentCounts(claims, kpiAgent)}
        title={role === "junior" ? `AI performance · All claims — ${JUNIOR_AGENT}` : kpiAgent ? `AI performance · ${kpiAgent}` : "AI performance · whole team"}
      />
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{role === "junior" ? "Agent review queue" : "Senior approval queue"}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{list.length} {list.length === 1 ? "claim" : "claims"}</p>
        </div>
        {role === "junior" && <NewClaimDialog />}
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {(["All", ...statusOptions] as const).map((s) => {
          const count = s === "All" ? base.length : filterable.filter((c) => c.status === s).length;
          const active = status === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => setStatus(s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-all duration-150",
                !active && "border-transparent bg-card text-foreground shadow-card hover:bg-accent",
                active && (s === "All" ? "border-foreground bg-foreground font-medium text-background" : cn(statusCls[s], "font-medium ring-1 ring-current")),
              )}
            >
              {s === "All" ? "All open" : s}
              <span className={cn("text-[12px] tabular-nums", active ? "opacity-75" : "text-muted-foreground")}>{count}</span>
            </button>
          );
        })}
      </div>
      <ClaimTable claims={list} loading={isLoading} />
      <div className="mb-4 mt-12">
        <h2 className="text-[22px] font-semibold leading-tight tracking-tight">Approved claims</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{approvedCount} {approvedCount === 1 ? "claim" : "claims"}{samples.length > 0 && " · sample history from other agents is view only"}</p>
      </div>
      <ClaimTable claims={approvedList} samples={samples} loading={isLoading} variant="approved" />
      {role === "junior" && <ClosedInactive claims={scoped.filter(isClosedInactive)} />}
    </main>
  );
}


function ClosedInactive({ claims }: { claims: Claim[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (claims.length === 0) return null;

  const reopen = async (c: Claim) => {
    setBusy(c.id);
    try {
      const now = new Date().toISOString();
      // Reopening restarts the operational clock: turnaround is measured from now, original FNOL is kept in notes.
      await updateClaim(c.id, {
        status: "Awaiting customer photos",
        created_at: now,
        review_started_at: null,
        active_review_seconds: 0,
        agent_notes: `${c.agent_notes ? c.agent_notes + "\n" : ""}Reopened ${new Date().toLocaleDateString()} after customer contact (originally opened ${new Date(c.created_at).toLocaleDateString()}). Turnaround clock reset.`,
      } as Partial<Claim>);
      await qc.invalidateQueries();
      toast.success(`${c.id} reopened — back in the queue`);
      navigate({ to: "/claims/$claimId", params: { claimId: c.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reopen claim");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-12">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mb-4 flex items-center gap-2 text-left">
        <ChevronRight className={cn("h-5 w-5 text-muted-foreground transition-transform", open && "rotate-90")} />
        <div>
          <h2 className="text-[22px] font-semibold leading-tight tracking-tight">Closed claims (inactive)</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {claims.length} {claims.length === 1 ? "claim" : "claims"} · auto-closed after 30 days without customer response · excluded from KPIs
          </p>
        </div>
      </button>
      {open && (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          <table className="w-full text-[13px]">
            <thead className="border-b text-left text-[12px] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Claim ID</th>
                <th className="px-4 py-3 font-medium">Policyholder</th>
                <th className="px-4 py-3 font-medium">Vehicle</th>
                <th className="px-4 py-3 font-medium">Date closed</th>
                <th className="px-4 py-3 font-medium">Closure reason</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id} className="border-b border-border/70 text-muted-foreground last:border-0">
                  <td className="px-4 py-3 font-mono font-medium text-foreground">{c.id}</td>
                  <td className="px-4 py-3 text-foreground">{c.policyholder}</td>
                  <td className="px-4 py-3">{vehicleLabel(c)}</td>
                  <td className="px-4 py-3 text-foreground">
                    {(() => {
                      const at = (c as Claim & { updated_at?: string }).updated_at;
                      return at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
                    })()}
                  </td>
                  <td className="px-4 py-3">Auto-closed after 30 days inactive · awaiting photos</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => reopen(c)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> {busy === c.id ? "Reopening…" : "Reopen claim"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function formatApprovedAt(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ClaimTable({
  claims,
  loading,
  showFlags = true,
  variant = "queue",
  samples = [],
}: {
  samples?: SampleApproved[];
  claims: Claim[];
  loading: boolean;
  showFlags?: boolean;
  variant?: "queue" | "approved";
}) {
  const { data: costs } = useQuery(costsQuery);
  const { role } = useRole();
  const navigate = useNavigate();
  const approved = variant === "approved";
  const junior = role === "junior";
  const colCount = approved ? 8 : showFlags ? 8 : 7;
  // Repair & settlement progress lives in this browser, so read it after hydration.
  const ids = approved && junior ? claims.map((c) => c.id).join(",") : "";
  const [settlement, setSettlement] = useState<Record<string, SettlementLabel>>({});
  useEffect(() => {
    if (!ids) return;
    const read = () => setSettlement(Object.fromEntries(ids.split(",").map((id) => [id, settlementLabel(readSettlement(id))])));
    read();
    window.addEventListener(SETTLEMENT_RESET_EVENT, read);
    return () => window.removeEventListener(SETTLEMENT_RESET_EVENT, read);
  }, [ids]);

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card">
      <table className="w-full text-[13px]">
        <thead className="border-b text-left text-[12px] text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Claim ID</th>
            <th className="px-4 py-3 font-medium">Policyholder</th>
            <th className="px-4 py-3 font-medium">Vehicle</th>
            <th className="px-4 py-3 text-right font-medium">Items</th>
            <th className="px-4 py-3 text-right font-medium">Est. total</th>
            <th className="px-4 py-3 text-right font-medium">Overrides</th>
            {approved ? (
              junior ? (
                <>
                  <th className="px-4 py-3 font-medium">Approved</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </>
              ) : (
                <>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Approved</th>
                </>
              )
            ) : (
              <>
                {showFlags && <th className="px-4 py-3 font-medium">Flags</th>}
                <th className="px-4 py-3 font-medium">Status</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={colCount} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
          )}
          {!loading && claims.length === 0 && samples.length === 0 && (
            <tr><td colSpan={colCount} className="px-4 py-10 text-center text-muted-foreground">{approved ? "No approved claims yet." : "No claims in this queue."}</td></tr>
          )}
          {claims.map((c) => {
            const f = claimFlags(c);
            return (
              <tr
                key={c.id}
                onClick={() => navigate({ to: "/claims/$claimId", params: { claimId: c.id } })}
                className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-accent"
              >
                <td className="px-4 py-3 font-mono font-medium">{c.id}</td>
                <td className="px-4 py-3">{c.policyholder}</td>
                <td className="px-4 py-3 text-muted-foreground">{vehicleLabel(c)}</td>
                <td className="px-4 py-3 text-right font-mono">{c.line_items.length}</td>
                <td className="px-4 py-3 text-right">{costs ? <Money value={estimateTotal(costs, c.line_items)} /> : "—"}</td>
                <td className={cn("px-4 py-3 text-right font-mono", claimOverrideCount(c) === 0 && "text-muted-foreground")}>{claimOverrideCount(c)}</td>
                {approved ? (
                  junior ? (
                    <>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatApprovedAt(c.approved_at)}</td>
                      <td className="px-4 py-3"><SettlementPill label={settlement[c.id] ?? "Awaiting shop quote"} /></td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-muted-foreground">{agentOf(c)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatApprovedAt(c.approved_at)}</td>
                    </>
                  )
                ) : (
                  <>
                    {showFlags && (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {f.returned && <Tag tone="danger">Returned</Tag>}
                          {f.inspection && <Tag tone="danger">Requires inspection</Tag>}
                          {f.lowConfidence && <Tag tone="warn">Low confidence</Tag>}
                          {f.photoIssue && <Tag tone="warn">Photo issue</Tag>}
                          {c.ai_result && !c.ai_result.can_assess && <Tag tone="warn">Not assessable</Tag>}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-3"><StatusPill status={c.status} senior={!junior} /></td>
                  </>
                )}
              </tr>
            );
          })}
          {samples.map((s) => (
            <tr key={s.id} title="Sample history — view only" className="cursor-default border-b border-border/70 last:border-0">
              <td className="px-4 py-3 font-mono font-medium">{s.id}</td>
              <td className="px-4 py-3">{s.policyholder}</td>
              <td className="px-4 py-3 text-muted-foreground">{s.vehicle}</td>
              <td className="px-4 py-3 text-right font-mono">{s.items}{s.added > 0 && <span className="text-muted-foreground"> (+{s.added} added)</span>}</td>
              <td className="px-4 py-3 text-right"><Money value={s.total} /></td>
              <td className={cn("px-4 py-3 text-right font-mono", s.overrides === 0 && "text-muted-foreground")}>{s.overrides}</td>
              <td className="px-4 py-3 text-muted-foreground">{s.agent} <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px]">View only</span></td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatApprovedAt(s.approved_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
