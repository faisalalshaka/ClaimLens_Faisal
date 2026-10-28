import { Check, Undo2 } from "lucide-react";
import { claimTimeline } from "@/lib/timeline";
import type { Claim } from "@/lib/claims";
import { cn } from "@/lib/utils";

const fmtAt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ClaimTimeline({ claim }: { claim: Claim }) {
  const steps = claimTimeline(claim);
  return (
    <ol aria-label="Claim timeline" className="mb-5 grid grid-cols-5 gap-2 rounded-2xl bg-card px-4 py-3 shadow-card">
      {steps.map((s, i) => (
        <li key={s.key} className="relative min-w-0" data-state={s.state}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                s.state === "done" && "bg-st-approved text-primary-foreground",
                s.state === "active" && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                s.state === "returned" && "bg-destructive text-primary-foreground",
                s.state === "upcoming" && "bg-muted text-muted-foreground",
              )}
            >
              {s.state === "done" ? <Check className="h-3 w-3" /> : s.state === "returned" ? <Undo2 className="h-3 w-3" /> : i + 1}
            </span>
            {i < steps.length - 1 && <span className={cn("h-px flex-1", s.state === "done" ? "bg-st-approved/50" : "bg-border")} />}
          </div>
          <div className={cn("mt-1.5 truncate text-[12px] font-medium", s.state === "upcoming" && "text-muted-foreground")}>{s.label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{s.at && s.state !== "upcoming" ? fmtAt(s.at) : "—"}</div>
          {s.note && <div className={cn("truncate text-[11px]", s.state === "returned" ? "text-destructive" : s.state === "active" ? "text-primary" : "text-muted-foreground")} title={s.note}>{s.note}</div>}
        </li>
      ))}
    </ol>
  );
}
