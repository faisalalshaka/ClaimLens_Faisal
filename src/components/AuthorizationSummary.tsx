import { CheckCircle2 } from "lucide-react";
import { partsPrice, partsTotal, estimateTotal, fmtHours, finalLaborHours, laborTotal, totalLaborHours, LABOR_RATE, vehicleLabel, type Claim, type CostTable } from "@/lib/claims";
import { Money } from "./claim-ui";
import { RepairShopRecommendations } from "./RepairShopRecommendations";

export function AuthorizationSummary({ claim, costs }: { claim: Claim; costs: CostTable }) {
  const totalHours = totalLaborHours(costs, claim.line_items);
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-2 ring-st-approved">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-5 w-5 text-st-approved" /> Authorization Summary
        </div>
        <span className="font-mono text-xs">{claim.id}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 px-4 py-3 text-xs">
        <div><div className="text-muted-foreground">Policyholder</div><div className="font-medium">{claim.policyholder}</div></div>
        <div><div className="text-muted-foreground">Vehicle</div><div className="font-medium">{vehicleLabel(claim)}</div></div>
        <div><div className="text-muted-foreground">Policy</div><div className="font-mono">{claim.policy_number}</div></div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-t bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="py-2 font-medium">Part</th>
            <th className="py-2 font-medium">Damage</th>
            <th className="py-2 font-medium">Action</th>
            <th className="py-2 text-right font-medium">Labor</th>
            <th className="px-4 py-2 text-right font-medium">Estimated Parts Price</th>
          </tr>
        </thead>
        <tbody>
          {claim.line_items.filter((i) => i.review_decision !== "rejected").map((i, n) => (
            <tr key={i.id} className="border-t">
              <td className="px-4 py-1.5 font-mono text-muted-foreground">{n + 1}</td>
              <td className="py-1.5 capitalize">{i.part}</td>
              <td className="py-1.5 text-muted-foreground">{i.damage_type} · {i.severity}</td>
              <td className="py-1.5 capitalize">{i.action}</td>
              <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">{fmtHours(finalLaborHours(costs, i))}</td>
              <td className="px-4 py-1.5 text-right"><Money value={partsPrice(costs, i)} /></td>
            </tr>
          ))}
          <tr className="border-t-2 bg-muted/50">
            <td colSpan={5} className="px-4 py-2 font-medium">Estimated Total Parts Price</td>
            <td className="px-4 py-2 text-right"><Money value={partsTotal(costs, claim.line_items)} /></td>
          </tr>
          <tr className="border-t bg-muted/50">
            <td colSpan={4} className="px-4 py-2 font-medium">Estimated Total Labor Cost <span className="font-normal text-muted-foreground">· <Money value={LABOR_RATE} />/hour</span></td>
            <td className="py-2 text-right font-mono tabular-nums">{fmtHours(totalHours)}</td>
            <td className="px-4 py-2 text-right"><Money value={laborTotal(costs, claim.line_items)} /></td>
          </tr>
          <tr className="border-t-2 bg-muted text-sm font-semibold">
            <td colSpan={5} className="px-4 py-2.5">Estimated Grand Total <span className="text-xs font-normal text-muted-foreground">· parts + labor</span></td>
            <td className="px-4 py-2.5 text-right"><Money value={estimateTotal(costs, claim.line_items)} /></td>
          </tr>
        </tbody>
      </table>
      <div className="space-y-1 border-t px-4 py-3 text-xs">
        <RepairShopRecommendations compact />
        <div>
          Approved by <span className="font-medium">Senior Adjuster</span> ·{" "}
          <span className="font-mono">{claim.approved_at ? new Date(claim.approved_at).toLocaleString() : "—"}</span>
        </div>
        <div className="font-medium">Authorized to proceed with repairs at an approved repair shop.</div>
      </div>
    </div>
  );
}
