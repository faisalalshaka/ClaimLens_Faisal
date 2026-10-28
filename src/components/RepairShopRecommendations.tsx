import { Wrench } from "lucide-react";

export const DEMO_SHOPS = [
  { name: "Northside Collision Center", address: "120 Example Avenue" },
  { name: "Metro Auto Body", address: "45 Demo Street" },
  { name: "Riverside Vehicle Repairs", address: "80 Sample Road" },
];

export function RepairShopRecommendations({ compact = false }: { compact?: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Wrench className="h-4 w-4 text-muted-foreground" /> Approved repair shops</h2>
      <ol className={compact ? "divide-y border-y" : "grid gap-3 md:grid-cols-3"}>
        {DEMO_SHOPS.map((shop, n) => (
          <li key={shop.name} className={compact ? "py-2 text-xs" : "rounded-2xl bg-card p-4 text-[13px] shadow-card"}>
            <div className="font-semibold">{n + 1}. {shop.name}</div>
            <div className="mt-1 text-muted-foreground">{shop.address}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
