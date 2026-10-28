import { cn } from "@/lib/utils";
import type { Severity, Status } from "@/lib/claims";
import type { SettlementLabel } from "@/lib/settlement";

export const statusCls: Record<Status, string> = {
  "Ready for agent review": "text-st-ready border-st-ready/15 bg-st-ready/10",
  "Awaiting customer photos": "text-st-awaiting border-st-awaiting/15 bg-st-awaiting/12",
  "Submitted to senior": "text-st-submitted border-st-submitted/15 bg-st-submitted/10",
  "Returned to agent": "text-st-returned border-st-returned/15 bg-st-returned/10",
  Approved: "text-st-approved border-st-approved/15 bg-st-approved/12",
};

export function StatusPill({ status, senior = false }: { status: Status; senior?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-medium", statusCls[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {senior && status === "Submitted to senior" ? "Pending review" : status}
    </span>
  );
}

const settlementCls: Record<SettlementLabel, string> = {
  "Awaiting shop quote": "text-st-awaiting border-st-awaiting/15 bg-st-awaiting/12",
  "Negotiating final price": "text-st-submitted border-st-submitted/15 bg-st-submitted/10",
  "Pending inspection": "text-st-ready border-st-ready/15 bg-st-ready/10",
  "Ready to close": "text-st-approved border-st-approved/15 bg-st-approved/12",
  Closed: "text-muted-foreground border-border bg-muted",
};

export function SettlementPill({ label }: { label: SettlementLabel }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-medium", settlementCls[label])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

export const sevBg: Record<Severity, string> = {
  minor: "bg-sev-minor",
  moderate: "bg-sev-moderate",
  severe: "bg-sev-severe",
};
export const sevBorder: Record<Severity, string> = {
  minor: "border-sev-minor",
  moderate: "border-sev-moderate",
  severe: "border-sev-severe",
};

export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-secondary text-secondary-foreground",
        tone === "warn" && "bg-sev-minor/25 text-foreground",
        tone === "danger" && "bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

export function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {value.toLocaleString("en-US", { style: "currency", currency: "USD" })}
    </span>
  );
}
