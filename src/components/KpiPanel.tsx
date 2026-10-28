import { ChevronDown } from "lucide-react";
import { kpisFromCounts, overrideBreakdown, OVERRIDE_SECTIONS, type KpiCounts } from "@/lib/claims";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const dur = (v: number | null) => {
  if (v == null) return "—";
  const min = v * 60;
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min.toFixed(1)} min`;
  return v < 48 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(1)} days`;
};
const n = (v: number) => v.toLocaleString();

/** Corner tally showing the raw numerator / denominator behind a percentage. */
type Tally = { num: number; den: number; title: string };
type Card = { label: string; value: string; hint: string; alarm: boolean; tally?: Tally; breakdown?: boolean };

export function KpiPanel({ counts, title }: { counts: KpiCounts; title: string }) {
  const k = kpisFromCounts(counts);
  const cards: Card[] = [
    {
      label: "AI override rate",
      value: pct(k.overrideRate),
      hint: "Sections overridden of 7 per AI line item · target < 15%",
      alarm: (k.overrideRate ?? 0) > 0.15,
      tally: { num: counts.overriddenFields, den: counts.overridableFields, title: `${n(counts.overriddenFields)} of ${n(counts.overridableFields)} overridable sections were overridden (${n(counts.overridableFields / 7)} AI line items on submitted claims × 7)` },
      breakdown: true,
    },
    {
      label: "Clean acceptance",
      value: pct(k.cleanAcceptance),
      hint: "Claims accepted exactly as AI proposed",
      alarm: k.cleanAcceptance != null && k.cleanAcceptance < 0.5,
      tally: { num: counts.cleanClaims, den: counts.reviewedClaims, title: `${n(counts.cleanClaims)} of ${n(counts.reviewedClaims)} submitted claims were accepted exactly as the AI proposed` },
    },
    { label: "Avg. time to submit", value: dur(k.avgTurnaroundHours), hint: "Active agent time per claim · target < 30 min", alarm: (k.avgTurnaroundHours ?? 0) * 60 > 30 },
    {
      label: "Missed items rate",
      value: pct(k.missedRate),
      hint: `Claims where agent added damage AI missed · ${counts.missedItems} line${counts.missedItems === 1 ? "" : "s"} added · target < 12%`,
      alarm: (k.missedRate ?? 0) > 0.12,
      tally: { num: counts.missedClaims, den: counts.reviewedClaims, title: `${n(counts.missedClaims)} of ${n(counts.reviewedClaims)} submitted claims had damage the agent added because the AI missed it` },
    },
    { label: "Total turnaround", value: dur(k.avgCycleHours), hint: `Claim opened → sent to senior${k.intakeShare != null ? ` · ${Math.round(k.intakeShare * 100)}% waiting on customer photos` : ""}`, alarm: false },
  ];
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                  {c.alarm && <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-label="Needs attention" />}
                  {c.label}
                </div>
                {c.tally && (
                  <span
                    title={c.tally.title}
                    aria-label={c.tally.title}
                    className="shrink-0 cursor-help rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-medium leading-none tabular-nums text-muted-foreground"
                  >
                    {n(c.tally.num)}/{n(c.tally.den)}
                  </span>
                )}
              </div>
              <div className={cn("mt-1 text-[28px] font-semibold leading-tight tracking-tight tabular-nums", c.alarm && "text-destructive")}>{c.value}</div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.hint}</div>
              {c.breakdown && (
                <div className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary">
                  See breakdown <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                </div>
              )}
            </>
          );
          const cardCls = "flex flex-col rounded-2xl bg-card px-4 py-3.5 text-left shadow-card";
          if (!c.breakdown) return <div key={c.label} className={cardCls}>{body}</div>;
          return (
            <Popover key={c.label}>
              <PopoverTrigger
                aria-label="Show AI override rate by section"
                className={cn(cardCls, "group transition-shadow hover:ring-1 hover:ring-primary/30 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 data-[state=open]:ring-1 data-[state=open]:ring-primary/40")}
              >
                {body}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[340px] rounded-2xl border-0 p-4 shadow-card">
                <OverrideBreakdown counts={counts} />
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
    </section>
  );
}

function OverrideBreakdown({ counts }: { counts: KpiCounts }) {
  const rows = overrideBreakdown(counts);
  const aiItems = counts.overridableFields / OVERRIDE_SECTIONS.length;
  const max = Math.max(...rows.map((r) => r.rate ?? 0), 0);
  return (
    <div>
      <div className="text-[14px] font-semibold tracking-tight">Where agents override the AI</div>
      {counts.overridableFields === 0 ? (
        <p className="mt-4 text-[12.5px] text-muted-foreground">No submitted claims yet — overrides count once a claim is sent to the senior adjuster.</p>
      ) : counts.overriddenFields === 0 ? (
        <p className="mt-4 text-[12.5px] text-muted-foreground">No overrides yet — every AI section was accepted as proposed.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((r, i) => (
            <li key={r.section} className="grid grid-cols-[84px_minmax(0,1fr)_40px] items-center gap-2.5 text-[12.5px]">
              <span className={cn("truncate", r.count > 0 && r.rate === max && "font-medium")}>{r.label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className={cn("block h-full rounded-full", r.count > 0 && r.rate === max ? "bg-primary" : "bg-primary/45")}
                  style={{ width: max ? `${((r.rate ?? 0) / max) * 100}%` : "0%" }}
                />
              </span>
              <span className="text-right font-medium tabular-nums" title={`${n(r.count)} of ${n(aiItems)} AI line items`}>
                {pct(r.rate)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 border-t pt-2.5 text-[11px] leading-snug text-muted-foreground">
        {n(counts.overriddenFields)} overrides in total. Rationale counts only when the agent wrote their own feedback. Use this to see which part of the AI's assessment needs tuning first.
      </p>
    </div>
  );
}
