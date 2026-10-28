import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ClipboardCheck, FileText, Handshake, Loader2, Lock, Plus, Upload, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { fmtHours, fmtUSD, LABOR_RATE, parseAmount } from "@/lib/claims";
import { quoteFileUrl, uploadQuote } from "@/lib/data";
import { clearSettlement, EMPTY_SETTLEMENT as EMPTY, quoteTotal, quoteTotals, readSettlement, settlementKey as key, settlementLabel, settlementStage, type QuoteRow, type Settlement } from "@/lib/settlement";
import { Money, SettlementPill } from "@/components/claim-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const stamp = (s?: string) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** A payable line from the carrier's authorization, used to pre-fill and compare the shop quote. */
export type AuthorizedLine = { id: string; part: string; damage: string; action: string; hours: number | null; price: number };
export type AuthorizedTotals = { parts: number; hours: number; labor: number; total: number };

export function RepairSettlement({ claimId, items: itemsProp, authorized: authProp, shops = [] }: { claimId: string; items?: AuthorizedLine[]; authorized?: AuthorizedTotals | number; shops?: string[] }) {
  // Tolerate missing/legacy props (e.g. a plain total during a hot reload) instead of blanking the page.
  const items = itemsProp ?? [];
  const authorized: AuthorizedTotals = typeof authProp === "number" || authProp == null
    ? { parts: 0, hours: 0, labor: 0, total: typeof authProp === "number" ? authProp : 0 }
    : authProp;
  const [s, setS] = useState<Settlement>(EMPTY);
  useEffect(() => {
    setS(readSettlement(claimId));
  }, [claimId]);
  const save = (patch: Partial<Settlement>) => {
    setS((prev) => { const next = { ...prev, ...patch }; localStorage.setItem(key(claimId), JSON.stringify(next)); return next; });
  };

  const seeded = useMemo<QuoteRow[]>(() => items.map((i) => ({ id: `q-${i.id}`, part: i.part, damage: i.damage, action: i.action, hours: "", price: "", authId: i.id })), [items]);
  const rows = s.quoteRows.length ? s.quoteRows : seeded;
  const quote = quoteTotal({ ...s, quoteRows: rows });
  const agreed = parseAmount(s.agreed);
  const stage = settlementStage(s);
  const closed = !!s.closedAt;
  const diff = (n: number | null) => (n == null ? null : n - authorized.total);
  const priced = rows.some((r) => parseAmount(r.price) != null || parseAmount(r.hours) != null);

  const steps = [
    { icon: Wrench, label: "Shop quote" },
    { icon: Handshake, label: "Final price" },
    { icon: ClipboardCheck, label: "Inspection" },
    { icon: Lock, label: "Closed" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-2 ring-primary">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="font-semibold">Repair &amp; Settlement Tracking</div>
        <SettlementPill label={settlementLabel(s)} />
      </div>
      <div className="grid grid-cols-4 gap-2 border-b px-4 py-3">
        {steps.map((st, i) => {
          const done = stage > i;
          const current = stage === i;
          return (
            <div key={st.label} className="flex items-center gap-2 text-[12px]">
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", done ? "bg-st-approved text-primary-foreground" : current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : <st.icon className="h-3.5 w-3.5" />}
              </span>
              <span className={cn(done || current ? "font-medium" : "text-muted-foreground")}>{st.label}</span>
            </div>
          );
        })}
      </div>

      <div className="space-y-4 px-4 py-4 text-[13px]">
        <div className="flex justify-between rounded-xl bg-muted px-3 py-2"><span className="text-muted-foreground">Carrier authorized estimate</span><span className="font-mono font-semibold">{fmtUSD(authorized.total)}</span></div>

        {/* 1. Shop quote */}
        <Section n={1} title="Repair shop assessment & quote" doneAt={s.quoteAt}>
          {s.quoteAt ? (
            <div className="space-y-2">
              <Summary rows={[["Shop", s.shop], ["Shop quote", fmtUSD(quote ?? 0)], ["Difference vs authorized", signed(diff(quote))]]} />
              {s.quoteFile && <QuoteFileChip file={s.quoteFile} />}
              {s.quoteRows.length > 0 && <QuoteTable rows={s.quoteRows} items={items} authorized={authorized} laborRate={s.laborRate} />}
              {s.quoteNote && <div className="rounded-xl border px-3 py-2 text-[12px] text-muted-foreground">{s.quoteNote}</div>}
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-foreground">Repair shop <span className="text-muted-foreground font-normal">· click to choose</span></span>
                <div className="relative">
                  <Wrench className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
                  <select
                    className={cn("h-11 w-full cursor-pointer appearance-none rounded-xl border-2 bg-card pl-9 pr-9 text-[13.5px] font-medium shadow-sm transition-colors hover:border-primary hover:bg-primary/5 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/20", s.shop ? "border-primary/40 text-foreground" : "border-primary text-primary")}
                    value={s.shop}
                    onChange={(e) => save({ shop: e.target.value })}
                  >
                    <option value="">Select repair shop…</option>
                    {shops.map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
                </div>
              </label>
              <QuoteUpload claimId={claimId} file={s.quoteFile} onChange={(quoteFile) => save({ quoteFile })} />
              <div className="text-[12px] text-muted-foreground">Enter the figures from the shop's quote below. Authorized amounts are shown under each box for comparison.</div>
              <QuoteTable rows={rows} items={items} authorized={authorized} laborRate={s.laborRate} onRows={(quoteRows) => save({ quoteRows })} onRate={(laborRate) => save({ laborRate })} />
              <Textarea rows={2} placeholder="Shop findings (e.g. hidden bracket damage found after teardown)" value={s.quoteNote} onChange={(e) => save({ quoteNote: e.target.value })} />
              <Button size="sm" disabled={!s.shop || !priced} onClick={() => save({ quoteRows: rows, quoteAt: new Date().toISOString() })}>Record shop quote</Button>
            </div>
          )}
        </Section>

        {/* 2. Negotiation */}
        {stage >= 1 && (
          <Section n={2} title="Negotiated final price" doneAt={s.agreedAt}>
            {s.agreedAt ? (
              <Summary rows={[["Agreed final price", fmtUSD(agreed ?? 0)], ["Supplement vs authorized", signed(diff(agreed))]]} note={s.negotiationNote} />
            ) : (
              <div className="grid gap-2">
                <Input inputMode="decimal" placeholder="Agreed final price ($)" value={s.agreed} onChange={(e) => save({ agreed: e.target.value })} />
                {agreed != null && <div className="text-[12px] text-muted-foreground">Supplement vs authorized: <span className="font-mono">{signed(diff(agreed))}</span></div>}
                <Textarea rows={2} placeholder="Negotiation notes (e.g. agreed OEM bracket, labor reduced to 3.0h)" value={s.negotiationNote} onChange={(e) => save({ negotiationNote: e.target.value })} />
                <div><Button size="sm" disabled={agreed == null} onClick={() => save({ agreedAt: new Date().toISOString() })}>Confirm final price</Button></div>
              </div>
            )}
          </Section>
        )}

        {/* 3. Inspection */}
        {stage >= 2 && (
          <Section n={3} title="Final inspection" doneAt={s.inspectedAt}>
            {s.inspectedAt ? (
              <Summary rows={[["Result", "Passed — repairs meet quality standards"]]} note={s.inspectionNote} />
            ) : (
              <div className="grid gap-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={s.inspectionPassed} onChange={(e) => save({ inspectionPassed: e.target.checked })} /> Repairs completed and passed quality inspection</label>
                <Textarea rows={2} placeholder="Inspection notes (optional)" value={s.inspectionNote} onChange={(e) => save({ inspectionNote: e.target.value })} />
                <div><Button size="sm" disabled={!s.inspectionPassed} onClick={() => save({ inspectedAt: new Date().toISOString() })}>Sign off inspection</Button></div>
              </div>
            )}
          </Section>
        )}

        {/* 4. Close */}
        {stage === 3 && (
          <Button className="w-full" onClick={() => { if (confirm("Settle the final payment and close this claim?")) save({ closedAt: new Date().toISOString() }); }}>
            <Lock className="mr-1.5 h-4 w-4" /> Settle &amp; close claim
          </Button>
        )}
        {closed && (
          <div className="flex items-center gap-2 rounded-xl bg-st-approved/10 px-3 py-2.5 text-[13px]">
            <CheckCircle2 className="h-4 w-4 text-st-approved" /> Settled at {fmtUSD(agreed ?? 0)} and closed {stamp(s.closedAt)}. Customer notified.
          </div>
        )}
        {(stage > 0 || s.quoteFile || s.quoteRows.length > 0) && (
          <button className="text-[12px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => { if (confirm("Clear repair & settlement tracking for this claim?")) { clearSettlement(claimId); setS(EMPTY); } }}>
            Reset tracking
          </button>
        )}
      </div>
    </div>
  );
}

function QuoteUpload({ claimId, file, onChange }: { claimId: string; file?: Settlement["quoteFile"]; onChange: (f: Settlement["quoteFile"]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (file) {
    return (
      <div className="flex items-center gap-2">
        <QuoteFileChip file={file} />
        <button className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Remove quote file" onClick={() => onChange(undefined)}><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  }
  return (
    <div>
      <input ref={input} type="file" accept="application/pdf,image/*" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setBusy(true);
        try { onChange({ path: await uploadQuote(claimId, f), name: f.name }); toast.success("Shop quote attached"); }
        catch (err) { toast.error(err instanceof Error ? err.message : "Upload failed. Please try again."); }
        finally { setBusy(false); }
      }} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 px-3 py-3 text-left transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25 disabled:opacity-60">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold text-primary">{busy ? "Uploading…" : "Upload shop quote"}</span>
          <span className="block text-[11.5px] text-muted-foreground">PDF or photo · click to browse · for reference only</span>
        </span>
      </button>
    </div>
  );
}

function QuoteFileChip({ file }: { file: NonNullable<Settlement["quoteFile"]> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    quoteFileUrl(file.path).then((u) => live && setUrl(u)).catch(() => live && setUrl(null));
    return () => { live = false; };
  }, [file.path]);
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className={cn("inline-flex min-w-0 items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-[12px] font-medium", url ? "text-primary hover:underline" : "pointer-events-none text-muted-foreground")}>
      <FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{file.name}</span> <span className="shrink-0 font-normal text-muted-foreground">· View</span>
    </a>
  );
}

const COLS = "grid grid-cols-[1.1rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,3.6rem)_minmax(0,5.4rem)_1.1rem] items-start gap-x-2";

function QuoteTable({ rows, items, authorized, laborRate, onRows, onRate }: { rows: QuoteRow[]; items: AuthorizedLine[]; authorized: AuthorizedTotals; laborRate: string; onRows?: (r: QuoteRow[]) => void; onRate?: (r: string) => void }) {
  const edit = !!onRows;
  const auth = new Map(items.map((i) => [i.id, i]));
  const t = quoteTotals(rows, laborRate);
  const set = (id: string, patch: Partial<QuoteRow>) => onRows?.(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const cell = "h-7 px-1.5 text-[12px]";
  return (
    <div className="overflow-hidden rounded-xl border text-[12px]">
      <div className={cn(COLS, "bg-muted px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground")}>
        <span>#</span><span>Part</span><span>Damage</span><span>Action</span><span className="text-right">Labor</span><span className="text-right">Parts Price</span><span />
      </div>
      {rows.map((r, n) => {
        const a = r.authId ? auth.get(r.authId) : undefined;
        return (
          <div key={r.id} className={cn(COLS, "border-t px-3 py-1.5")}>
            <span className="pt-1.5 font-mono text-muted-foreground">{n + 1}</span>
            <div className="min-w-0">
              {edit ? <Input className={cn(cell, "capitalize")} value={r.part} placeholder="Part" onChange={(e) => set(r.id, { part: e.target.value })} /> : <div className="pt-1 capitalize">{r.part}</div>}
              {!a && <div className="mt-0.5 text-[10.5px] font-medium text-primary">Added by shop</div>}
            </div>
            {edit ? <Input className={cell} value={r.damage} placeholder="Damage" onChange={(e) => set(r.id, { damage: e.target.value })} /> : <div className="pt-1 text-muted-foreground">{r.damage}</div>}
            {edit ? <Input className={cn(cell, "capitalize")} value={r.action} placeholder="Action" onChange={(e) => set(r.id, { action: e.target.value })} /> : <div className="pt-1 capitalize">{r.action}</div>}
            <div className="min-w-0 text-right">
              {edit ? (
                <div className="relative"><Input className={cn(cell, "pr-4 text-right font-mono")} inputMode="decimal" value={r.hours} placeholder="0.0" onChange={(e) => set(r.id, { hours: e.target.value })} /><span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground">h</span></div>
              ) : <div className="pt-1 font-mono tabular-nums">{fmtHours(parseAmount(r.hours) ?? 0)}</div>}
              {a && <div className="mt-0.5 text-[10.5px] text-muted-foreground">Auth {fmtHours(a.hours)}</div>}
            </div>
            <div className="min-w-0 text-right">
              {edit ? (
                <div className="relative"><span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground">$</span><Input className={cn(cell, "pl-4 text-right font-mono")} inputMode="decimal" value={r.price} placeholder="0.00" onChange={(e) => set(r.id, { price: e.target.value })} /></div>
              ) : <div className="pt-1"><Money value={parseAmount(r.price) ?? 0} /></div>}
              {a && <div className="mt-0.5 text-[10.5px] text-muted-foreground">Auth {fmtUSD(a.price)}</div>}
            </div>
            {edit ? (
              <button className="mt-1.5 rounded-full text-muted-foreground hover:text-destructive" aria-label={`Remove line ${n + 1}`} onClick={() => onRows?.(rows.filter((x) => x.id !== r.id))}><X className="h-3.5 w-3.5" /></button>
            ) : <span />}
          </div>
        );
      })}
      {edit && (
        <button className="flex w-full items-center gap-1.5 border-t px-3 py-2 text-[12px] font-medium text-primary hover:bg-muted/60" onClick={() => onRows?.([...rows, { id: `s-${Date.now()}`, part: "", damage: "", action: "", hours: "", price: "" }])}>
          <Plus className="h-3.5 w-3.5" /> Add line from shop quote
        </button>
      )}

      {/* Side-by-side totals: carrier authorization vs shop quote */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_minmax(0,6rem)_minmax(0,6rem)] border-t-2 bg-muted/50 px-3 py-2">
        <span />
        <span className="text-right text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Authorized</span>
        <span className="text-right text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Shop quote</span>
        <span className="text-right text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Difference</span>
        <TotalRow label="Total Parts Price" a={authorized.parts} q={t.parts} />
        <TotalRow
          label={<>Total Labor Cost <span className="font-normal text-muted-foreground">· {fmtHours(t.hours)} at {edit ? (
            <span className="relative inline-block w-14 align-middle"><span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2">$</span><Input aria-label="Shop labor rate per hour" className="h-6 pl-3 pr-1 text-right font-mono text-[11px]" inputMode="decimal" value={laborRate} onChange={(e) => onRate?.(e.target.value)} /></span>
          ) : fmtUSD(parseAmount(laborRate) ?? LABOR_RATE)}/hour</span></>}
          a={authorized.labor}
          q={t.labor}
        />
        <TotalRow label="Grand Total" a={authorized.total} q={t.total} strong />
      </div>
    </div>
  );
}

function TotalRow({ label, a, q, strong }: { label: React.ReactNode; a: number; q: number; strong?: boolean }) {
  const d = Math.round((q - a) * 100) / 100;
  return (
    <>
      <span className={cn("border-t border-border/60 py-1.5", strong ? "font-semibold" : "font-medium")}>{label}</span>
      <span className="border-t border-border/60 py-1.5 text-right"><Money value={a} /></span>
      <span className={cn("border-t border-border/60 py-1.5 text-right", strong && "font-semibold")}><Money value={q} /></span>
      <span className={cn("border-t border-border/60 py-1.5 text-right font-mono tabular-nums", d > 0 ? "text-destructive" : d < 0 ? "text-st-approved" : "text-muted-foreground")}>{d === 0 ? "—" : `${d > 0 ? "+" : "−"}${fmtUSD(Math.abs(d))}`}</span>
    </>
  );
}

function signed(n: number | null) {
  if (n == null) return "—";
  return n === 0 ? "$0.00 (matches)" : `${n > 0 ? "+" : "−"}${fmtUSD(Math.abs(n))}`;
}

function Section({ n, title, doneAt, children }: { n: number; title: string; doneAt?: string | undefined; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium">{n}. {title}</div>
        {doneAt && <span className="text-[11px] text-muted-foreground">{stamp(doneAt)}</span>}
      </div>
      {children}
    </div>
  );
}

function Summary({ rows, note }: { rows: [string, string][]; note?: string | undefined }) {
  return (
    <div className="rounded-xl border px-3 py-2">
      {rows.map(([k, v]) => <div key={k} className="flex justify-between py-0.5"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>)}
      {note && <div className="mt-1 border-t pt-1 text-[12px] text-muted-foreground">{note}</div>}
    </div>
  );
}
