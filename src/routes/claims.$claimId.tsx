import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, Camera, ChevronRight, Flag, Loader2, Lock, Plus, RefreshCw, RotateCcw, Send, Undo2, X, Check, Trash2 } from "lucide-react";
import { claimQuery, costsQuery, photoUrlsQuery, updateClaim, uploadPhoto } from "@/lib/data";
import { useRole } from "@/lib/role";
import { analyzeClaim } from "@/lib/analyze.functions";
import {
  ACTIONS, DAMAGE_TYPES, PARTS, SEVERITIES, INITIAL_PHOTO_REQUEST, addPhotos, canDeleteItem, deleteAgentItem,
  applyManualOverride, revertItemToAi, canRevertItem, canDeletePhoto, removePhoto, revertsToOriginal, fieldOverrideReason, hasOverrides, overrideComments, rowTone, type RowTone, fmtUSD, fmtAmount, parseAmount, addedTextSegments, splitRationale, joinRationale, isFeedbackOnlyChange, AGENT_FEEDBACK_REASON, reviewLineItem, calcPartsPrice, partsPrice, laborHours, finalLaborHours, parseHours, totalLaborHours, laborTotal, partsTotal, fmtHours, priceBreakdown, LABOR_RATE, changedIds, diffItems, estimateTotal, isLowConfidence, issueText, sortItems, vehicleLabel,
  canSeniorApprove, canReturnToAgent, applySeniorFlags, resolveSeniorFlags, openSeniorFlags, seniorReturnSummary,
  type Change, type Claim, type CostTable, type LineItem, type SeniorFlagDrafts,
  vehicleMismatchText,
} from "@/lib/claims";
import { ClaimTimeline } from "@/components/ClaimTimeline";
import { PhotoViewer } from "@/components/PhotoViewer";
import { RepairShopRecommendations } from "@/components/RepairShopRecommendations";
import { AuthorizationSummary } from "@/components/AuthorizationSummary";
import { RepairSettlement } from "@/components/RepairSettlement";
import { EditClaimDialog } from "@/components/NewClaimDialog";
import { clearSettlement } from "@/lib/settlement";
import { DEMO_SHOPS } from "@/components/RepairShopRecommendations";
import { Money, StatusPill, Tag, sevBg } from "@/components/claim-ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/claims/$claimId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.claimId} · ClaimLens` },
      { name: "description", content: `Damage assessment and estimate for claim ${params.claimId}.` },
      { property: "og:title", content: `${params.claimId} · ClaimLens` },
      { property: "og:description", content: `Damage assessment and estimate for claim ${params.claimId}.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ClaimPage,
});

const JUNIOR_EDITABLE = ["Ready for agent review", "Returned to agent", "Awaiting customer photos"];

function ClaimPage() {
  const { claimId } = Route.useParams();
  const { data: claim, isLoading } = useQuery(claimQuery(claimId));
  const { data: costs } = useQuery(costsQuery);
  if (isLoading || !costs) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!claim) return <div className="p-6">Claim not found.</div>;
  return <ClaimDetail key={claim.id} claim={claim} costs={costs} />;
}

type Prompt = null | { kind: "request"; title: string; label: string } | { kind: "item-reject"; item: LineItem; title: string; label: string } | { kind: "edit"; item: LineItem; patch: Partial<LineItem>; title: string; label: string };

function ClaimDetail({ claim, costs }: { claim: Claim; costs: CostTable }) {
  const { role } = useRole();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeClaim);
  const { data: urls = claim.photos.map(() => null) } = useQuery(photoUrlsQuery(claim.photos));

  const editable = role === "junior" && JUNIOR_EDITABLE.includes(claim.status);
  const [items, setItems] = useState<LineItem[]>(claim.line_items);
  const [notes, setNotes] = useState(claim.agent_notes);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [draft, setDraft] = useState<Partial<LineItem> | null>(null);
  // Senior Adjuster's revision notes, pinned to line items while reviewing (no pop-up, evidence stays in view).
  const seniorReviewing = role === "senior" && claim.status === "Submitted to senior";
  const [flags, setFlags] = useState<SeniorFlagDrafts>({});
  const flagCount = Object.keys(flags).length;
  useEffect(() => setItems(claim.line_items), [claim.line_items]);

  // Review clock: starts when the junior agent opens a claim that's ready for their review.
  const reviewStart = useRef<string | null>(null);
  const reviewable = role === "junior" && (claim.status === "Ready for agent review" || claim.status === "Returned to agent");
  useEffect(() => {
    if (!reviewable || claim.review_started_at || reviewStart.current) return;
    reviewStart.current = new Date().toISOString();
    updateClaim(claim.id, { review_started_at: reviewStart.current }).catch(() => {});
  }, [reviewable, claim.id, claim.review_started_at]);

  // Active touch stopwatch: runs only while this claim is open and visible; pauses when the agent leaves and resumes later.
  const touch = useRef({ base: 0, since: null as number | null });
  const touchTotal = () => touch.current.base + (touch.current.since ? (Date.now() - touch.current.since) / 1000 : 0);
  const flushTouch = (resume: boolean) => {
    const total = Math.round(touchTotal());
    touch.current = { base: total, since: resume ? Date.now() : null };
    return total;
  };
  useEffect(() => {
    if (!reviewable) return;
    touch.current = { base: claim.active_review_seconds ?? 0, since: document.visibilityState === "visible" ? Date.now() : null };
    const save = () => updateClaim(claim.id, { active_review_seconds: flushTouch(false) } as never).catch(() => {});
    const onVis = () => {
      if (document.visibilityState === "hidden") save();
      else touch.current.since = Date.now();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", save);
      if (touch.current.since) save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewable, claim.id]);

  const sorted = useMemo(() => sortItems(items), [items]);
  const numbers = useMemo(() => new Map(sorted.map((i, n) => [i.id, n + 1])), [sorted]);
  const changes = useMemo(() => diffItems(costs, claim.ai_line_items, items), [costs, claim.ai_line_items, items]);
  const aiById = useMemo(() => new Map(claim.ai_line_items.map((i) => [i.id, i])), [claim.ai_line_items]);
  const changed = changedIds(changes);
  const total = estimateTotal(costs, items);
  const totalLabor = totalLaborHours(costs, items);
  const laborCost = laborTotal(costs, items);
  const ai = claim.ai_result;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["claim", claim.id] }), qc.invalidateQueries({ queryKey: ["claims"] })]);

  async function persistItems(next: LineItem[]) {
    const previous = items;
    setItems(next);
    setBusy("Saving review…");
    try {
      await updateClaim(claim.id, { line_items: next });
      await refresh();
      return true;
    } catch {
      setItems(previous);
      toast.error("Could not save changes.");
      return false;
    } finally {
      setBusy(null);
    }
  }
  const patchItem = (id: string, patch: Partial<LineItem>) => persistItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const [toRevert, setToRevert] = useState<LineItem | null>(null);
  async function confirmRevert() {
    const original = toRevert ? aiById.get(toRevert.id) : undefined;
    if (!toRevert || !original) return setToRevert(null);
    const current = items.find((i) => i.id === toRevert.id) ?? toRevert;
    const reverted = revertItemToAi(current, original);
    // Replace the whole item (not a merge) so the cleared Accept/Reject decision doesn't linger.
    if (await persistItems(items.map((i) => (i.id === current.id ? reverted : i)))) toast.success("Line item restored to the original AI assessment");
    setToRevert(null);
  }

  const [toDelete, setToDelete] = useState<LineItem | null>(null);
  async function confirmDelete() {
    if (!toDelete) return;
    const id = toDelete.id;
    if (await persistItems(deleteAgentItem(items, id, claim.ai_line_items))) {
      if (selected === id) setSelected(null);
      toast.success("Agent-added line item deleted");
    }
    setToDelete(null);
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error && e.message.includes("photo format") ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  // Confirmation before replacing an analyzed photo (which re-analyzes every photo) would undo the agent's review work.
  const [confirmRerun, setConfirmRerun] = useState<null | { upload?: () => void }>(null);
  // Only warn when re-analysis would undo agent work: overrides, decisions, or agent-added items.
  const reviewWouldReset = items.some((i) => {
    const original = aiById.get(i.id);
    return !original || i.confidence == null || canRevertItem(i, original);
  });

  const awaitingPhotos = claim.status === "Awaiting customer photos";

  /** The AI analyzes new photos right after upload; only the new photos, so existing line items and review work stay. */
  async function analyzeAfterUpload(count: number) {
    setBusy("Analyzing new photo(s)…");
    const res = await analyze({ data: { claimId: claim.id, markReady: awaitingPhotos } });
    const s = count > 1 ? "s" : "";
    if (!res.ok) toast.error(`Photo${s} added, but the AI analysis didn't finish: ${res.error}`);
    else if (res.added != null)
      toast.success(res.added ? `AI analysis completed: ${res.added} new line item${res.added > 1 ? "s" : ""} from the new photo${s}` : `AI analysis completed: no new damage found in the new photo${s}`);
    else toast.success("AI analysis completed");
    await refresh();
  }
  /** Replacing a photo the AI already analyzed needs a full re-analysis, which would replace the agent's review work. */
  const guardUpload = (index: number, go: () => void) =>
    (claim.photos[index] && claim.ai_result?.analyzed_photos?.includes(claim.photos[index]!) && reviewWouldReset ? setConfirmRerun({ upload: go }) : go());

  const uploadSlot = (index: number, file: File) => guardUpload(index, () =>
    void run("Uploading…", async () => {
      const path = await uploadPhoto(claim.id, file);
      const photos = [...claim.photos];
      photos[index] = path;
      await updateClaim(claim.id, { photos: Array.from(photos, (p) => p ?? null) });
      await analyzeAfterUpload(1);
    }));

  const addPhotosAndRerun = (files: File[]) =>
    run("Uploading photos…", async () => {
      const paths: string[] = [];
      for (const f of files) paths.push(await uploadPhoto(claim.id, f));
      await updateClaim(claim.id, { photos: addPhotos(claim.photos, paths) });
      setBusy("Running AI analysis…");
      const res = await analyze({ data: { claimId: claim.id, markReady: true } });
      if (!res.ok) toast.error(res.error);
      else toast.success("Photos received, claim ready for agent review");
      await refresh();
    });

  const addMorePhotos = (files: File[]) => (
    void run("Uploading photos…", async () => {
      const paths: string[] = [];
      for (const f of files) paths.push(await uploadPhoto(claim.id, f));
      await updateClaim(claim.id, { photos: addPhotos(claim.photos, paths) });
      await analyzeAfterUpload(paths.length);
    }));

  const deletePhoto = (index: number) => {
    if (!canDeletePhoto(claim, index)) return;
    const found = [...claim.line_items].filter((i) => i.photo_index === index).length;
    if (!window.confirm(`Remove photo ${index + 1} from this claim? Use this only for a photo uploaded by mistake.${found ? ` The ${found} line item${found > 1 ? "s" : ""} found on this photo will be removed too.` : ""}`)) return;
    void run("Removing photo…", async () => {
      await updateClaim(claim.id, removePhoto(claim, index) as never);
      await refresh();
      toast.success("Photo removed");
    });
  };

  const submitToSenior = () =>
    run("Submitting…", async () => {
      if (items.some((i) => !i.review_decision)) { toast.error("Accept or reject every line item before submitting."); return; }
      const now = new Date().toISOString();
      const seconds = flushTouch(false);
      // The senior's notes are worked through on resubmission: mark them resolved but keep them on the items.
      await updateClaim(claim.id, { status: "Submitted to senior", agent_notes: notes, line_items: resolveSeniorFlags(items), rejection_reason: null, submitted_at: now, review_started_at: claim.review_started_at ?? reviewStart.current ?? now, active_review_seconds: Math.max(1, seconds) } as never);
      toast.success(`${claim.id} submitted to Senior Adjuster`);
      await refresh();
      navigate({ to: "/" });
    });

  const approve = () =>
    run("Approving…", async () => {
      if (!canSeniorApprove(flags)) { toast.error("Clear the flagged line items before approving."); return; }
      await updateClaim(claim.id, { status: "Approved", approved_at: new Date().toISOString() });
      clearSettlement(claim.id); // a fresh approval starts repair & settlement tracking from scratch
      toast.success(`${claim.id} approved`);
      await refresh();
    });

  /** One click: the senior's per-item notes become the revision checklist the junior sees. */
  const returnToAgent = () =>
    run("Returning…", async () => {
      if (!canReturnToAgent(flags)) { toast.error("Add a note to every flagged line item."); return; }
      const next = applySeniorFlags(items, flags);
      const flagged = sorted.filter((i) => i.id in flags).map((i) => ({ n: numbers.get(i.id) ?? 0, part: i.part }));
      await updateClaim(claim.id, { status: "Returned to agent", line_items: next, rejection_reason: seniorReturnSummary(flagged) } as never);
      setFlags({});
      toast.success(`${claim.id} returned to Junior Agent with ${flagged.length} revision${flagged.length === 1 ? "" : "s"}`);
      await refresh();
      navigate({ to: "/" });
    });

  async function onPromptSubmit(text: string) {
    if (!prompt) return;
    if (prompt.kind === "edit") {
      if (!await patchItem(prompt.item.id, applyManualOverride(prompt.item, prompt.patch, text, aiById.get(prompt.item.id)))) return;
      toast.success("Line item marked as overridden");
    } else if (prompt.kind === "item-reject") {
      if (!await patchItem(prompt.item.id, reviewLineItem(prompt.item, "rejected", text))) return;
      toast.success("Line item rejected and retained");
    } else if (prompt.kind === "request") {
      await run("Updating…", async () => {
        touch.current = { base: 0, since: null };
        await updateClaim(claim.id, { status: "Awaiting customer photos", photo_request_reason: text, agent_notes: notes } as never);
        await refresh();
      });
    }
    setPrompt(null);
  }

  function saveDraft() {
    const d = draft;
    if (!d) return;
    if (!d.bbox || d.photo_index == null) {
      toast.error("Draw a box on a photo before saving.");
      return;
    }
    if (!d.part || !d.damage_type || !d.severity || !d.action || !d.rationale?.trim()) {
      toast.error("Fill in all fields.");
      return;
    }
    const item: LineItem = {
      id: `ag-${Date.now().toString(36)}`,
      photo_index: d.photo_index,
      part: d.part,
      damage_type: d.damage_type,
      severity: d.severity,
      action: d.action,
      confidence: null,
      review_decision: "accepted",
      bbox: d.bbox,
      rationale: d.rationale.trim(),
    };
    persistItems([...items, item]);
    setDraft(null);
    setSelected(item.id);
  }

  const banners: { tone: "warn" | "danger"; text: string }[] = [];
  const openFlags = openSeniorFlags(items);
  if (claim.status === "Returned to agent" && openFlags.length)
    banners.push({ tone: "danger", text: `Returned by Senior Adjuster: ${openFlags.length} line item${openFlags.length === 1 ? "" : "s"} flagged for revision. See the Senior Adjuster note on each highlighted item.` });
  else if (claim.status === "Returned to agent" && claim.rejection_reason)
    banners.push({ tone: "danger", text: `Returned by Senior Adjuster: ${claim.rejection_reason}` });
  if (ai && !ai.can_assess) banners.push({ tone: "danger", text: "AI could not assess this claim" });
  if (ai?.requires_inspection)
    banners.push({ tone: "danger", text: `Requires in-person inspection – ${ai.requires_inspection_reason ?? "see line items"}` });
  const vehicleMismatch = vehicleMismatchText(ai, claim.photos);
  if (vehicleMismatch)
    banners.push({ tone: "warn", text: `Vehicle mismatch – ${vehicleMismatch}. Confirm the vehicle with the policyholder before estimating.` });
  if (ai?.narrative_mismatch)
    banners.push({ tone: "warn", text: `Description mismatch – ${(ai.narrative_mismatch_reason ?? "photos show damage to a different area than the customer described").replace(/\.+$/, "")}. Verify with the policyholder.` });
  ai?.photo_quality.filter((p) => !p.usable).forEach((p) => banners.push({ tone: "warn", text: `Photo ${p.photo_index + 1}: ${issueText(p.issue)}` }));
  if (claim.status === "Awaiting customer photos" && claim.photo_request_reason)
    banners.push({ tone: "warn", text: claim.photo_request_reason === INITIAL_PHOTO_REQUEST ? INITIAL_PHOTO_REQUEST : `More photos requested: ${claim.photo_request_reason}` });

  return (
    <main className="mx-auto max-w-[1600px] px-5 pb-16 pt-5">
      <Link to="/" className="mb-3 inline-flex items-center gap-0.5 text-[13px] font-medium text-primary transition-opacity hover:opacity-75">
        <ChevronLeft className="h-4 w-4" /> Queue
      </Link>
      <div className="mb-5 flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{claim.policyholder}</h1>
            <StatusPill status={claim.status} senior={role === "senior"} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span className="font-mono font-medium text-foreground">{claim.id}</span>
            <span aria-hidden>·</span>
            <span>{vehicleLabel(claim)}</span>
            <span aria-hidden>·</span>
            <span>Policy <span className="font-mono">{claim.policy_number}</span></span>
            <span aria-hidden>·</span>
            <span>Accident {claim.accident_date}</span>
            {editable && <span className="-my-1"><EditClaimDialog claim={claim} /></span>}
          </div>
          <p className="mt-2 max-w-3xl text-[13px] text-muted-foreground">{claim.description}</p>
        </div>
        {busy && !/^(Uploading|Analyzing|Running AI)/.test(busy) && <span className="ml-auto flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-[12px] text-muted-foreground shadow-card"><Loader2 className="h-3.5 w-3.5 animate-spin" />{busy}</span>}
      </div>
      <ClaimTimeline claim={claim} />

      {banners.length > 0 && (
        <div className="mb-5 space-y-2">
          {banners.map((b, i) => (
            <div key={i} className={cn("flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-[13px]", b.tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-sev-minor/20 text-foreground")}>
              <AlertTriangle className="h-4 w-4 shrink-0" /> {b.text}
            </div>
          ))}
        </div>
      )}

      {claim.status === "Approved" && (
        <div className="mb-5 grid gap-5 xl:grid-cols-2">
          <AuthorizationSummary claim={claim} costs={costs} />
          {role === "junior" && (
            <RepairSettlement
              claimId={claim.id}
              items={claim.line_items.filter((i) => i.review_decision !== "rejected").map((i) => ({ id: i.id, part: i.part, damage: `${i.damage_type} · ${i.severity}`, action: i.action, hours: finalLaborHours(costs, i), price: partsPrice(costs, i) }))}
              authorized={{ parts: partsTotal(costs, claim.line_items), hours: totalLaborHours(costs, claim.line_items), labor: laborTotal(costs, claim.line_items), total: estimateTotal(costs, claim.line_items) }}
              shops={DEMO_SHOPS.map((x) => x.name)}
            />
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(13.5rem,22%)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26%)_minmax(0,1fr)]">
        <section className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl bg-card p-3 shadow-card">
            <PhotoViewer
              urls={urls}
              items={items}
              numbers={numbers}
              selectedId={selected}
              onSelect={setSelected}
              quality={ai?.photo_quality}
              drawMode={!!draft}
              draftBox={draft?.bbox && draft.photo_index != null ? { photo_index: draft.photo_index, bbox: draft.bbox } : null}
              onDraw={(photo_index, bbox) => setDraft((d) => ({ ...d, photo_index, bbox }))}
              onUploadSlot={editable && !busy ? uploadSlot : undefined}
              onAddPhotos={editable && !busy && !draft && !awaitingPhotos ? addMorePhotos : undefined}
              canDeletePhoto={role === "junior" && editable && !busy && !draft ? (i) => canDeletePhoto(claim, i) : undefined}
              onDeletePhoto={deletePhoto}
            />
          </div>
          {editable && awaitingPhotos && <AddPhotos onFiles={addPhotosAndRerun} disabled={!!busy} hasPhotos={claim.photos.some(Boolean)} />}
        </section>

        <section className="min-w-0 space-y-5">
          <div className="relative rounded-2xl bg-card shadow-card">
            {busy && /^(Uploading|Analyzing|Running AI)/.test(busy) && (
              <div role="status" aria-live="polite" className="absolute inset-0 z-20 flex items-start justify-center rounded-2xl bg-card/60 pt-24 backdrop-blur-sm">
                <div className="flex items-center gap-3 rounded-2xl bg-card px-5 py-4 shadow-card ring-1 ring-primary/20">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <div>
                    <div className="text-[15px] font-semibold tracking-tight">{busy.startsWith("Uploading") ? "Uploading new photo(s)…" : busy}</div>
                    <div className="text-[12px] text-muted-foreground">Line items update when the AI finishes</div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-[18px] pb-2 pt-4">
              <h2 className="text-[17px] font-semibold tracking-tight">Line-item review</h2>
              {editable && !draft && (
                <Button size="sm" variant="ghost" className="text-primary hover:text-primary" disabled={!claim.photos.some(Boolean)} title={claim.photos.some(Boolean) ? undefined : "Upload photos before adding line items"} onClick={() => setDraft({ rationale: "" })}>
                  <Plus className="h-4 w-4" /> Add line item
                </Button>
              )}
            </div>
            <div className={cn(ITEM_COLS, "border-b px-4 pb-2 text-[11px] font-medium text-muted-foreground")}>
              <div>#</div>
              <div>Part</div>
              <div>Damage</div>
              <div>Severity</div>
              <div>Action</div>
              <div className="text-center">Confidence</div>
              <div className="text-center" title={`Labor hours × ${fmtUSD(LABOR_RATE)}/hour`}>Labor</div>
              <div className="text-right" title="Parts plus paint & materials, before labor">Parts Price</div>
              <div className="pl-4 text-center">Review</div>
            </div>
            <div className="space-y-1 p-1.5" aria-label="Line items">
              {sorted.length === 0 && !draft && (
                <div className="px-3 py-8 text-center text-muted-foreground">No line items.</div>
              )}
              {sorted.map((i) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  n={numbers.get(i.id) ?? 0}
                  costs={costs}
                  editable={editable && !busy}
                  selected={selected === i.id}
                  original={aiById.get(i.id)}
                  changed={changed.has(i.id) && (role === "senior" || hasOverrides(i, aiById.get(i.id)))}
                  onSelect={() => setSelected(i.id)}
                  onPatch={async (p) => {
                    const original = aiById.get(i.id);
                    if (i.confidence == null) {
                      await patchItem(i.id, applyManualOverride(i, p, "", original));
                      return;
                    }
                    if (revertsToOriginal(p, original)) {
                      if (await patchItem(i.id, applyManualOverride(i, p, "", original))) toast.success("Restored to the original AI assessment");
                      return;
                    }
                    if (isFeedbackOnlyChange(i, p)) {
                      await patchItem(i.id, applyManualOverride(i, p, AGENT_FEEDBACK_REASON, original));
                      return;
                    }
                    setPrompt({ kind: "edit", item: i, patch: p, ...overridePromptText(i, p, costs) });
                  }}
                  onAccept={() => patchItem(i.id, reviewLineItem(i, "accepted"))}
                  onReject={() => setPrompt({ kind: "item-reject", item: i, title: `Reject Line Item · ${titleCase(i.part)}`, label: "Reason for rejection (required)" })}
                  onDelete={canDeleteItem(i, claim.ai_line_items) ? () => setToDelete(i) : undefined}
                  onRevert={editable && !busy && canRevertItem(i, aiById.get(i.id)) ? () => setToRevert(i) : undefined}
                  seniorFlag={seniorReviewing && !busy ? {
                    flagged: i.id in flags,
                    note: flags[i.id] ?? "",
                    onToggle: () => setFlags(({ [i.id]: had, ...rest }) => (had === undefined ? { ...rest, [i.id]: "" } : rest)),
                    onNote: (note) => setFlags((f) => ({ ...f, [i.id]: note })),
                  } : undefined}
                />
              ))}
              {draft && <DraftRow draft={draft} setDraft={setDraft} costs={costs} onSave={saveDraft} onCancel={() => setDraft(null)} />}
            </div>
            <div className="border-t px-[18px] pt-3">
              <div className="flex items-center justify-between gap-2 rounded-t-xl border-b border-background bg-muted/70 px-3 py-2" aria-label="Total parts cost">
                <div>
                  <div className="text-[12px] font-medium">Total parts cost</div>
                  <div className="text-[11px] text-muted-foreground">Parts price of all payable line items</div>
                </div>
                <Money value={partsTotal(costs, items)} className="text-[15px] font-semibold tracking-tight" />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-b-xl bg-muted/70 px-3 py-2" aria-label="Total labor cost">
                <div>
                  <div className="text-[12px] font-medium">Total labor cost</div>
                  <div className="text-[11px] text-muted-foreground">{fmtHours(totalLabor)} × {fmtUSD(LABOR_RATE)}/hour</div>
                </div>
                <Money value={laborCost} className="text-[15px] font-semibold tracking-tight" />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-[18px] py-3.5">
              <div>
                <div className="text-[13px] font-semibold">Estimate total</div>
                <div className="text-[11px] text-muted-foreground">Rejected items excluded · parts price + labor · standard repair cost database</div>
              </div>
              <Money value={total} className="text-[22px] font-semibold tracking-tight" />
            </div>
          </div>

          <div className="space-y-2 rounded-2xl bg-card p-4 shadow-card">
            <h2 className="text-[15px] font-semibold tracking-tight">Agent notes</h2>
            {editable ? (
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== claim.agent_notes && updateClaim(claim.id, { agent_notes: notes })} rows={3} placeholder="Add notes for the Senior Adjuster" className="text-[13px]" />
            ) : (
              <div className="min-h-10 text-[13px]">{claim.agent_notes || <span className="text-muted-foreground">No notes.</span>}</div>
            )}
          </div>

          {role === "senior" && claim.status !== "Approved" && <ChangesPanel changes={changes} numbers={numbers} />}

          {claim.status !== "Approved" && <RepairShopRecommendations />}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {editable && (
              <>
                <Button onClick={submitToSenior} disabled={!!busy || !!draft || items.some((i) => !i.review_decision) || claim.status === "Awaiting customer photos"}>
                  <Send className="h-4 w-4" /> Submit to Senior Adjuster
                </Button>
                {claim.status !== "Awaiting customer photos" && (
                  <Button variant="outline" disabled={!!busy} onClick={() => setPrompt({ kind: "request", title: "Request more photos", label: "Reason (required)" })}>
                    <Camera className="h-3.5 w-3.5" /> Request more photos
                  </Button>
                )}
              </>
            )}
            {seniorReviewing && (
              <>
                <Button onClick={approve} disabled={!!busy || !canSeniorApprove(flags)}><Check className="h-4 w-4" /> Approve</Button>
                <Button
                  variant={flagCount ? "default" : "outline"}
                  disabled={!!busy || !canReturnToAgent(flags)}
                  onClick={returnToAgent}
                  className={cn(flagCount > 0 && "bg-st-awaiting text-primary-foreground hover:bg-st-awaiting/90")}
                >
                  <Undo2 className="h-3.5 w-3.5" /> Return to Junior Agent{flagCount ? ` (${flagCount} revision${flagCount === 1 ? "" : "s"})` : ""}
                </Button>
                <span className={cn("text-[13px]", flagCount ? "font-medium text-st-awaiting" : "text-muted-foreground")} aria-live="polite">
                  {!flagCount
                    ? "To send it back, flag the line items that need changes and add a note to each."
                    : !canReturnToAgent(flags)
                      ? "Add a note to every flagged line item to return the claim."
                      : `${flagCount} line item${flagCount === 1 ? "" : "s"} flagged · clear the flags to approve instead.`}
                </span>
              </>
            )}
            {!editable && role === "junior" && claim.status !== "Approved" && (
              <span className="text-[13px] text-muted-foreground">Read-only: this claim is with the Senior Adjuster.</span>
            )}
            {role === "senior" && JUNIOR_EDITABLE.includes(claim.status) && (
              <span className="text-[13px] text-muted-foreground">Read-only: this claim is with the Junior Agent.</span>
            )}
          </div>
        </section>
      </div>

      <PromptDialog prompt={prompt} onClose={() => setPrompt(null)} onSubmit={onPromptSubmit} />

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Line Item · {toDelete ? titleCase(toDelete.part) : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the line item you added and its drawn box. AI line items can't be deleted — reject them instead.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!!busy} onClick={confirmDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Delete line item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!toRevert} onOpenChange={(o) => !o && setToRevert(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revert to AI Assessment · {toRevert ? titleCase(toRevert.part) : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Every change on this line item goes back to what the AI found: Part, Damage, Severity, Action, Labor and Parts Price,
            and your Agent feedback notes are cleared. Your Accept or Reject choice is cleared too, so you can review it again.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToRevert(null)}>Cancel</Button>
            <Button disabled={!!busy} onClick={confirmRevert}>
              <RotateCcw className="h-3.5 w-3.5" /> Revert line item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmRerun} onOpenChange={(o) => !o && setConfirmRerun(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace Photo?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Replacing a photo the AI already analyzed means every photo is analyzed again, so the line items are replaced by its new assessment. Your overrides, Agent feedback notes, Accept and Reject choices, and any line items you added will be cleared.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRerun(null)}>Cancel</Button>
            <Button disabled={!!busy} onClick={() => {
              const upload = confirmRerun?.upload;
              setConfirmRerun(null);
              upload?.();
            }}>
              <RefreshCw className="h-3.5 w-3.5" /> Replace photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

const cellSelect =
  "h-8 w-full min-w-0 truncate rounded-lg border border-input bg-card px-1.5 text-[12.5px] capitalize transition-[border-color,box-shadow] focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/25";

/** Shared column layout for the line-item header and rows; every column can shrink, so the list never scrolls sideways. */
const ITEM_COLS =
  "grid grid-cols-[1.75rem_minmax(0,1.3fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.95fr)_4.75rem_3.75rem_5.5rem_6.25rem] gap-x-1.5";

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const FIELD_LABELS: Record<string, string> = {
  part: "Part", damage_type: "Damage", severity: "Severity", action: "Action", price_override: "Parts Price", labor_hours_override: "Labor", rationale: "Rationale",
};

/** Popup title/label naming the exact column being overridden, e.g. "Override Severity · Rear Bumper". */
function overridePromptText(item: LineItem, patch: Partial<LineItem>, costs: CostTable) {
  const field = Object.keys(patch).find((f) => f in FIELD_LABELS) ?? "";
  const name = FIELD_LABELS[field] ?? "Line Item";
  const title = `Override ${name} · ${titleCase(item.part)}`;
  if (field === "price_override") {
    return { title, label: `Parts Price: ${fmtUSD(partsPrice(costs, item))} → ${fmtUSD(patch.price_override ?? calcPartsPrice(costs, item))}. Reason for change (required)` };
  }
  if (field === "labor_hours_override") {
    return { title, label: `Labor: ${fmtHours(finalLaborHours(costs, item))} → ${fmtHours(patch.labor_hours_override ?? laborHours(costs, item))}. Reason for change (required)` };
  }
  if (field === "rationale") return { title, label: patch.rationale ? "Reason for changing the rationale (required)" : "Reason for removing the AI's rationale (required)" };
  const from = String(item[field as keyof LineItem] ?? "");
  const to = String(patch[field as keyof LineItem] ?? "");
  return { title, label: `${name}: ${titleCase(from)} → ${titleCase(to)}. Reason for override (required)` };
}

/** "Overridden" label under a changed column; the reason itself is listed in the rationale's Agent feedback. */
function OverrideNote({ item, field, original }: { item: LineItem; field: string; original?: LineItem | undefined; tagOnly?: boolean }) {
  const reason = fieldOverrideReason(item, field, original);
  if (reason == null) return null;
  const ai = CHOICE_FIELDS.includes(field) && original ? String(original[field as keyof LineItem] ?? "") : "";
  return (
    <div className="mt-1 text-left" title={reason ? `Reason: ${reason}` : undefined}>
      {ai && <div className="mb-0.5 truncate text-[11px] text-muted-foreground">AI: <span className="capitalize line-through">{ai}</span></div>}
      <Tag tone="warn">Overridden</Tag>
    </div>
  );
}

const CHOICE_FIELDS = ["part", "damage_type", "severity", "action"];

/** " (Repair → Replace)" for dropdown columns that differ from the AI; empty otherwise. */
function fieldDelta(field: string, item: LineItem, original?: LineItem): string {
  if (!original || !CHOICE_FIELDS.includes(field)) return "";
  const from = String(original[field as keyof LineItem] ?? ""), to = String(item[field as keyof LineItem] ?? "");
  return from && from !== to ? ` (${titleCase(from)} → ${titleCase(to)})` : "";
}

/**
 * Rationale box. For AI line items the AI's text sits on top and the agent's own notes go below a divider
 * labelled "Agent feedback", typed in blue as they write. The AI's text is read-only (older edits to it stay
 * highlighted); feedback saves without a reason prompt. Agent-added items have a single editable box.
 */
function RationaleField({ item, original, n, editable, onPatch }: {
  item: LineItem; original?: LineItem | undefined; n: number; editable: boolean; onPatch: (p: Partial<LineItem>) => void;
}) {
  const [editing, setEditing] = useState<null | "feedback">(null);
  const aiItem = !!original && item.confidence != null;
  const { base, feedback } = aiItem ? splitRationale(item.rationale ?? "") : { base: item.rationale ?? "", feedback: "" };
  const segments = aiItem ? addedTextSegments(original?.rationale ?? "", base) : [{ text: base, added: false }];
  const baseText = base ? segments.map((s, k) =>
    s.added ? <mark key={k} className="rounded bg-primary/12 px-0.5 text-primary">{s.text}</mark> : <span key={k}>{s.text}</span>,
  ) : <span className="italic opacity-70">{aiItem ? "No AI rationale" : "No rationale"}</span>;
  const comments = aiItem ? overrideComments(item, original) : [];
  const commentList = comments.length > 0 && (
    <ul className="space-y-0.5 text-primary" aria-label={`Override comments for item ${n}`}>
      {comments.map((c) => (
        <li key={c.field} className="whitespace-pre-wrap break-words"><span className="font-semibold">{c.label}{fieldDelta(c.field, item, original)}:</span> {c.reason}</li>
      ))}
    </ul>
  );
  const feedbackSection = (content: ReactNode) => (
    <div className="mt-2 border-t border-primary/25 pt-1.5">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Agent feedback</div>
      {commentList}
      {content && <div className={cn(comments.length > 0 && "mt-0.5")}>{content}</div>}
    </div>
  );
  const hasFeedback = !!feedback || comments.length > 0;
  const bare = "min-h-0 resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 text-xs leading-snug shadow-none focus-visible:ring-0 md:text-xs";

  if (!editable)
    return (
      <div className="pt-1 leading-snug">
        <p className="whitespace-pre-wrap break-words">{baseText}</p>
        {hasFeedback && feedbackSection(feedback ? <p className="whitespace-pre-wrap break-words text-primary">{feedback}</p> : null)}
      </div>
    );

  if (!aiItem) {
    if (editing)
      return (
        <AutoTextarea
          autoFocus
          aria-label={`Rationale for item ${n}`}
          defaultValue={item.rationale}
          className="min-h-0 resize-none overflow-hidden text-xs md:text-xs"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const value = e.target.value.trim();
            setEditing(null);
            if (value !== (item.rationale ?? "").trim()) onPatch({ rationale: value });
          }}
        />
      );
    return (
      <button
        type="button"
        aria-label={`Rationale for item ${n}`}
        onClick={(e) => { e.stopPropagation(); setEditing("feedback"); }}
        className="block w-full cursor-text whitespace-pre-wrap break-words rounded-md border border-input bg-card px-3 py-2 text-left text-xs leading-snug text-foreground/80 shadow-xs transition-[border-color] hover:border-ring/60"
      >
        {baseText}
      </button>
    );
  }

  const commit = (box: HTMLElement) => {
    const f = box.querySelector<HTMLTextAreaElement>("textarea[data-part=feedback]")?.value ?? feedback;
    setEditing(null);
    const next = joinRationale(base, f);
    if (next !== joinRationale(base, feedback)) onPatch({ rationale: next });
  };

  return (
    <div
      className={cn(
        "w-full rounded-md border bg-card px-3 py-2 text-left text-xs leading-snug text-foreground/80 shadow-xs transition-[border-color,box-shadow]",
        editing ? "border-ring ring-[3px] ring-ring/25" : "cursor-text border-input hover:border-ring/60",
      )}
      onClick={(e) => { e.stopPropagation(); if (!editing) setEditing("feedback"); }}
      onMouseDown={(e) => { if (editing && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault(); }}
      onBlur={(e) => { if (editing && !e.currentTarget.contains(e.relatedTarget as Node | null)) commit(e.currentTarget); }}
    >
      {editing ? (
        <>
          <p className="whitespace-pre-wrap break-words" aria-label={`AI rationale for item ${n}`}>{baseText}</p>
          {feedbackSection(
            <AutoTextarea
              data-part="feedback"
              aria-label={`Agent feedback for item ${n}`}
              autoFocus={editing === "feedback"}
              defaultValue={feedback}
              placeholder="Add your notes…"
              className={cn(bare, "font-medium text-primary placeholder:font-normal placeholder:text-primary/45")}
            />,
          )}
        </>
      ) : (
        <>
          <p
            className="whitespace-pre-wrap break-words"
            aria-label={`Rationale for item ${n}`}
          >
            {baseText}
          </p>
          {hasFeedback && feedbackSection(feedback ? <p className="whitespace-pre-wrap break-words font-medium text-primary">{feedback}</p> : null)}
        </>
      )}
    </div>
  );
}

const TONE_BG: Record<RowTone, string> = {
  overridden: "bg-highlight",
  added: "bg-added",
  accepted: "bg-st-approved/10",
  rejected: "bg-destructive/8",
  none: "bg-muted/70",
};

function ItemRow({ item, original, n, costs, editable, selected, changed: _changed, onSelect, onPatch, onAccept, onReject, onDelete, onRevert, seniorFlag }: {
  item: LineItem; original?: LineItem | undefined; n: number; costs: CostTable; editable: boolean; selected: boolean; changed: boolean;
  onSelect: () => void; onPatch: (p: Partial<LineItem>) => void; onAccept: () => void; onReject: () => void; onDelete?: (() => void) | undefined;
  onRevert?: (() => void) | undefined;
  /** Senior Adjuster reviewing: flag this item for revision with an inline note. */
  seniorFlag?: { flagged: boolean; note: string; onToggle: () => void; onNote: (note: string) => void } | undefined;
}) {
  const calc = calcPartsPrice(costs, item);
  const price = partsPrice(costs, item);
  const stdHours = laborHours(costs, item);
  const hours = finalLaborHours(costs, item);
  const low = isLowConfidence(item);
  const priceOverridden = item.price_override != null && item.confidence != null;
  const laborOverridden = item.labor_hours_override != null && item.confidence != null;
  const sel = <K extends keyof LineItem>(k: K, opts: readonly string[]) =>
    editable ? (
      <select className={cellSelect} title={String(item[k])} value={String(item[k])} onClick={(e) => e.stopPropagation()} onChange={(e) => onPatch({ [k]: e.target.value } as Partial<LineItem>)}>
        {opts.map((o) => <option key={o} value={o}>{original && item.confidence != null && String(original[k]) === o && String(item[k]) !== o ? `${o} (AI Analysis)` : o}</option>)}
      </select>
    ) : (
      <span className="block truncate pt-1.5 capitalize">{String(item[k])}</span>
    );
  const decision = item.review_decision;
  const tone = rowTone(item, original);
  return (
    <div
      // Capture phase: dropdowns, inputs and buttons stop click bubbling, but touching any cell must still select the row.
      onPointerDownCapture={() => { if (!selected) onSelect(); }}
      onFocusCapture={() => { if (!selected) onSelect(); }}
      onClick={onSelect}
      data-tone={tone}
      data-selected={selected ? "true" : undefined}
      data-flagged={seniorFlag?.flagged || (item.senior_flag && !item.senior_flag.resolved) ? "true" : undefined}
      className={cn("item-row cursor-pointer items-start gap-y-2 rounded-xl px-2.5 py-2.5 text-[12.5px]", ITEM_COLS, TONE_BG[tone])}
    >
      <div className="pt-1.5">
        <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[11px] font-semibold tabular-nums text-primary-foreground", sevBg[item.severity])}>{n}</span>
      </div>
      <div className="min-w-0">
        {sel("part", PARTS)}
        {item.confidence == null && (
          <div className="mt-1 flex flex-wrap gap-1"><Tag>Agent added</Tag></div>
        )}
        <OverrideNote item={item} original={original} field="part" />
      </div>
      <div className="min-w-0">{sel("damage_type", DAMAGE_TYPES)}<OverrideNote item={item} original={original} field="damage_type" /></div>
      <div className="min-w-0">{sel("severity", SEVERITIES)}<OverrideNote item={item} original={original} field="severity" /></div>
      <div className="min-w-0">{sel("action", ACTIONS)}<OverrideNote item={item} original={original} field="action" /></div>
      <div className="flex min-w-0 flex-col items-center gap-1 pt-1.5">
        <span className={cn("font-mono", low ? "font-semibold text-sev-moderate" : "text-muted-foreground")}>
          {item.confidence == null ? "—" : `${Math.round(item.confidence * 100)}%`}
        </span>
        {low && (
          <span className="rounded-lg bg-sev-minor/25 px-1.5 py-0.5 text-center text-[10px] font-medium leading-tight whitespace-nowrap text-foreground">
            Low – Verify
          </span>
        )}
      </div>
      <div className="min-w-0 text-center" title={hours != null ? `${hours.toFixed(1)} h × ${fmtUSD(LABOR_RATE)}/hour = ${fmtUSD(hours * LABOR_RATE)}` : undefined}>
        {editable && hours != null ? (
          <div className="flex h-8 w-full items-center rounded-lg border border-input bg-card transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25" onClick={(e) => e.stopPropagation()}>
            <input
              key={hours}
              type="text"
              inputMode="decimal"
              aria-label={`Labor hours for item ${n}`}
              defaultValue={hours.toFixed(1)}
              className="h-full w-full min-w-0 bg-transparent pl-1.5 text-right font-mono text-[11.5px] tabular-nums outline-none"
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={(e) => {
                const v = parseHours(e.target.value);
                if (v == null) { e.target.value = hours.toFixed(1); return; }
                if (v !== hours) onPatch({ labor_hours_override: v === stdHours ? null : v });
                e.target.value = hours.toFixed(1);
              }}
            />
            <span className="select-none pl-0.5 pr-1.5 text-[11.5px] text-muted-foreground" aria-hidden>h</span>
          </div>
        ) : (
          <span className={cn("block pt-1.5 font-mono text-[12px] tabular-nums", laborOverridden && "font-semibold")}>{fmtHours(hours)}</span>
        )}
        {laborOverridden && <div className="mt-0.5 text-[11px] text-muted-foreground">Std. <span className="line-through">{fmtHours(stdHours)}</span></div>}
        <div className="flex justify-center"><OverrideNote item={item} original={original} field="labor_hours_override" /></div>
      </div>
      <div className="min-w-0 text-right" title={priceBreakdown(costs, item) ?? undefined}>
        {editable ? (
          <div className="flex h-8 w-full items-center rounded-lg border border-input bg-card transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25" onClick={(e) => e.stopPropagation()}>
            <span className="pl-1.5 text-[11.5px] text-muted-foreground">$</span>
            <input
              key={price}
              type="text"
              inputMode="decimal"
              aria-label={`Parts price for item ${n}`}
              defaultValue={fmtAmount(price)}
              className="h-full w-full min-w-0 bg-transparent pl-0.5 pr-1.5 text-right font-mono text-[11.5px] tabular-nums outline-none"
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={(e) => {
                const v = parseAmount(e.target.value);
                if (v == null) { e.target.value = fmtAmount(price); return; }
                if (v !== price) onPatch({ price_override: v === calc ? null : v });
                e.target.value = fmtAmount(price);
              }}
            />
          </div>
        ) : (
          <span className="block pt-1.5"><Money value={price} className={cn(priceOverridden && "font-semibold")} /></span>
        )}
        {priceOverridden && <div className="mt-0.5 text-[11px] text-muted-foreground">Calculated <Money value={calc} className="line-through" /></div>}
        <div className="flex justify-end"><OverrideNote item={item} original={original} field="price_override" /></div>
      </div>
      <div className="col-start-9 row-span-2 row-start-1 min-w-0 pl-4">
        {editable ? (
          <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={onAccept}
              aria-pressed={decision === "accepted"}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1 rounded-full px-2 text-[12px] font-medium transition-all duration-150 active:scale-[0.97]",
                decision === "accepted"
                  ? "bg-st-approved text-primary-foreground"
                  : "bg-st-approved/12 text-st-approved hover:bg-st-approved/20",
              )}
            >
              <Check className="h-3.5 w-3.5" /> {decision === "accepted" ? "Accepted" : "Accept"}
            </button>
            {item.confidence != null && (
            <button
              type="button"
              onClick={onReject}
              aria-pressed={decision === "rejected"}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1 rounded-full px-2 text-[12px] font-medium transition-all duration-150 active:scale-[0.97]",
                decision === "rejected"
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-destructive/10 text-destructive hover:bg-destructive/18",
              )}
            >
              <X className="h-3.5 w-3.5" /> {decision === "rejected" ? "Rejected" : "Reject"}
            </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-full px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <span className={cn(
              "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              decision === "accepted" && "bg-st-approved/12 text-st-approved",
              decision === "rejected" && "bg-destructive/10 text-destructive",
              !decision && "bg-secondary text-secondary-foreground",
            )}>
              {decision === "accepted" ? <><Check className="h-3 w-3" /> Accepted</> : decision === "rejected" ? <><X className="h-3 w-3" /> Rejected</> : "Pending review"}
            </span>
            {seniorFlag && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); seniorFlag.onToggle(); }}
                aria-pressed={seniorFlag.flagged}
                title={seniorFlag.flagged ? "Remove the flag" : "Flag this line item for the Junior Agent to revise"}
                className={cn(
                  "inline-flex h-8 w-full items-center justify-center gap-1 rounded-full px-2 text-[12px] font-medium transition-all duration-150 active:scale-[0.97]",
                  seniorFlag.flagged ? "bg-st-awaiting text-primary-foreground" : "bg-st-awaiting/12 text-st-awaiting hover:bg-st-awaiting/20",
                )}
              >
                <Flag className="h-3.5 w-3.5" /> {seniorFlag.flagged ? "Flagged" : "Flag"}
              </button>
            )}
          </div>
        )}
      </div>
      {onRevert && (
        <div className="col-start-1 row-start-2 pt-0.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRevert(); }}
            title="Revert all changes to the original AI assessment"
            aria-label={`Revert item ${n} to the original AI assessment`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-st-awaiting/30 bg-card text-st-awaiting shadow-sm transition-colors hover:bg-st-awaiting hover:text-primary-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="col-span-7 col-start-2 row-start-2 flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 gap-2">
          <span className="w-16 shrink-0 pt-1 text-[11px] font-medium text-muted-foreground">Rationale</span>
          <div className="min-w-0 flex-1 text-[12px] text-muted-foreground">
            <RationaleField item={item} original={original} n={n} editable={editable} onPatch={onPatch} />
            <OverrideNote item={item} original={original} field="rationale" tagOnly />
          </div>
        </div>
        {decision === "rejected" && item.rejection_reason && (
          <div className="flex min-w-0 gap-2">
            <span className="w-16 shrink-0 pt-0.5 text-[11px] font-medium leading-tight text-destructive">Rejection comments</span>
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-lg bg-destructive/8 px-3 py-1.5 text-[12px] leading-snug text-destructive">{item.rejection_reason}</p>
          </div>
        )}
        {item.senior_flag && (
          <div className="flex min-w-0 gap-2">
            <span className={cn("w-16 shrink-0 pt-0.5 text-[11px] font-medium leading-tight", item.senior_flag.resolved ? "text-muted-foreground" : "text-st-awaiting")}>
              {item.senior_flag.resolved ? "Earlier senior note" : "Senior Adjuster note"}
            </span>
            <div
              aria-readonly="true"
              title="Note from the Senior Adjuster · read only"
              className={cn("min-w-0 flex-1 cursor-default select-text rounded-md border-l-[3px] px-3 py-1.5 text-[12px] italic leading-snug", item.senior_flag.resolved ? "border-border bg-muted/60 text-muted-foreground" : "border-st-awaiting bg-st-awaiting/10 text-foreground")}
            >
              <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium not-italic uppercase tracking-wide text-muted-foreground">
                <Lock className="h-3 w-3" aria-hidden /> Read only
              </div>
              <p className="whitespace-pre-wrap break-words">“{item.senior_flag.note}”</p>
              {item.senior_flag.resolved && <div className="mt-0.5 text-[11px] not-italic">Revised and resubmitted by the agent</div>}
            </div>
          </div>
        )}
        {seniorFlag?.flagged && (
          <div className="flex min-w-0 gap-2" onClick={(e) => e.stopPropagation()}>
            <span className="w-16 shrink-0 pt-1 text-[11px] font-semibold leading-tight text-st-awaiting">Revision request</span>
            <div className="min-w-0 flex-1 rounded-lg border-l-[3px] border-st-awaiting bg-card p-2 ring-1 ring-st-awaiting/40">
              <AutoTextarea
                autoFocus={!seniorFlag.note}
                aria-label={`Senior note for item ${n}`}
                defaultValue={seniorFlag.note}
                onChange={(e) => seniorFlag.onNote(e.target.value)}
                placeholder="What should the agent change? e.g. Labor 2.5 h is high for a clear-coat repair, use 1.5 h."
                className="min-h-0 resize-none overflow-hidden bg-card text-xs md:text-xs"
              />
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                <span className={cn(seniorFlag.note.trim() ? "text-muted-foreground" : "font-medium text-st-awaiting")}>
                  {seniorFlag.note.trim() ? "Sent to the Junior Agent with this item" : "Note required"}
                </span>
                <button type="button" onClick={seniorFlag.onToggle} className="font-medium text-muted-foreground hover:text-foreground">
                  Remove flag
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Text box that grows to fit its text, so long notes never need an inner scrollbar. */
function AutoTextarea(props: ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useEffect(() => {
    fit();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <Textarea ref={ref} rows={1} {...props} onInput={(e) => { fit(); props.onInput?.(e); }} />;
}

function DraftRow({ draft, setDraft, costs, onSave, onCancel }: {
  draft: Partial<LineItem>; setDraft: (d: Partial<LineItem>) => void; costs: CostTable; onSave: () => void; onCancel: () => void;
}) {
  const s = (k: keyof LineItem, opts: readonly string[]) => (
    <select className={cellSelect} value={(draft[k] as string) ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
      <option value="" disabled>Select…</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const price = draft.part && draft.action && draft.severity ? calcPartsPrice(costs, draft as LineItem) : null;
  return (
    <div className={cn(ITEM_COLS, "items-start gap-y-2 rounded-xl border-2 border-dashed border-primary/35 bg-added/60 px-2 py-2 text-[12.5px]")}>
      <div className="pt-1.5 text-[11px] font-semibold text-primary">New</div>
      <div className="min-w-0">{s("part", PARTS)}</div>
      <div className="min-w-0">{s("damage_type", DAMAGE_TYPES)}</div>
      <div className="min-w-0">{s("severity", SEVERITIES)}</div>
      <div className="min-w-0">{s("action", ACTIONS)}</div>
      <div className="pt-1.5 text-center text-muted-foreground">—</div>
      <div className="pt-1.5 text-center font-mono tabular-nums text-muted-foreground">{price != null ? fmtHours(laborHours(costs, draft as LineItem)) : "—"}</div>
      <div className="pt-1.5 text-right">{price != null ? <Money value={price} /> : "—"}</div>
      <div className="col-start-9 row-span-2 row-start-1 flex flex-col gap-1.5 pl-4">
        <Button size="sm" className="h-8" onClick={onSave} disabled={!draft.bbox}>Save</Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={onCancel}>Cancel</Button>
      </div>
      <div className="col-span-7 col-start-2 row-start-2 min-w-0">
        <Input className="h-8 text-[12.5px]" placeholder="Rationale" value={draft.rationale ?? ""} onChange={(e) => setDraft({ ...draft, rationale: e.target.value })} />
        <div className={cn("mt-1.5 text-[11px] font-medium", draft.bbox ? "text-st-approved" : "text-destructive")}>
          {draft.bbox ? `Box drawn on photo ${(draft.photo_index ?? 0) + 1}` : "Draw a box on the photo (required)"}
        </div>
      </div>
    </div>
  );
}

function ChangesPanel({ changes, numbers }: { changes: Change[]; numbers: Map<string, number> }) {
  const grouped = new Map<string, Change[]>();
  for (const change of changes) {
    if (change.kind === "decision" && change.decision === "accepted") continue;
    const group = grouped.get(change.item.id) ?? [];
    group.push(change);
    grouped.set(change.item.id, group);
  }
  const accepted = changes.filter((c) => c.kind === "decision" && c.decision === "accepted").length;
  const rejected = changes.filter((c) => c.kind === "decision" && c.decision === "rejected").length;
  return (
    <section aria-label="Agent review summary" className="rounded-2xl bg-card px-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight">Agent review summary</h2>
        <span className="text-xs text-muted-foreground">{accepted} accepted · {rejected} rejected</span>
      </div>
      {grouped.size === 0 ? (
        <p className="pb-3 text-xs text-muted-foreground">No adjustments to the AI estimate.</p>
      ) : (
        <div className="divide-y border-t pb-1">
          {[...grouped.entries()].map(([id, group]) => {
            const item = group[0]?.item;
            if (!item) return null;
            const decision = group.find((c) => c.kind === "decision");
            const added = group.some((c) => c.kind === "added");
            const removed = group.some((c) => c.kind === "removed");
            const isRejected = decision?.kind === "decision" && decision.decision === "rejected";
            const label = isRejected ? "Rejected" : removed ? "Removed" : added ? "Agent added" : "Overridden";
            const reasons = [...new Set(group.flatMap((c) => c.kind === "decision" || c.kind === "override" ? [c.reason] : c.kind === "modified" ? [c.item.manual_override_reason ?? ""] : []).filter(Boolean))];
            return (
              <details key={id} className="group py-2.5">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-sm text-xs focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                  <span className="tabular-nums text-muted-foreground">#{numbers.get(id) ?? "—"}</span>
                  <span className="font-medium capitalize">{item.part}</span>
                  <span className={cn("ml-auto inline-flex items-center gap-1 text-xs font-medium", isRejected || removed ? "text-destructive" : "text-muted-foreground")}>
                    {isRejected || removed ? <X className="h-3 w-3 shrink-0" /> : <Check className="h-3 w-3 shrink-0" />}{label}
                  </span>
                  {reasons.length > 0 && <span className="w-full pl-6 text-muted-foreground">{reasons.join(" · ")}</span>}
                </summary>
                <div className="mt-2 space-y-1 border-l pl-3 ml-6 text-xs text-muted-foreground">
                  {group.map((c, index) => (
                    <div key={index}>
                      {c.kind === "added" && <span className="capitalize">{c.item.damage_type} · {c.item.severity} · {c.item.action}</span>}
                      {c.kind === "removed" && <span>Original AI item: {c.item.damage_type} · {c.item.severity} · {c.item.action}</span>}
                      {c.kind === "decision" && <span>Excluded from the payable estimate.</span>}
                      {c.kind === "modified" && c.fields.map((f) => <div key={f.field}><span className="capitalize">{f.field}</span>: {f.from} → <span className="font-medium text-foreground">{f.to}</span></div>)}
                      {c.kind === "override" && <span>Parts price: <Money value={c.calculated} /> → <Money value={c.price} className="font-medium text-foreground" /></span>}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AddPhotos({ onFiles, disabled, hasPhotos }: { onFiles: (f: File[]) => void; disabled: boolean; hasPhotos: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-4 rounded-2xl border-2 border-dashed border-input bg-card p-4">
      <div className="mb-1 text-[15px] font-semibold tracking-tight">{hasPhotos ? "Customer photo upload" : "Waiting for the customer's damage photos"}</div>
      <p className="mb-2 text-xs text-muted-foreground">
        Upload on the customer's behalf. Any number of photos can be added. Uploading runs AI analysis and moves the claim to Ready for agent review.
      </p>
      <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) onFiles(f); e.target.value = ""; }} />
      <Button size="sm" disabled={disabled} onClick={() => ref.current?.click()}><Camera className="h-4 w-4" /> Upload customer photos</Button>
    </div>
  );
}

function PromptDialog({ prompt, onClose, onSubmit }: {
  prompt: Prompt; onClose: () => void; onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => { setText(""); }, [prompt]);
  const valid = text.trim().length > 0;
  return (
    <Dialog open={!!prompt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{prompt?.title}</DialogTitle>
        </DialogHeader>
        {prompt && <div className="text-[13px] text-muted-foreground">{prompt.label}</div>}
        <Textarea aria-label="Reason" placeholder="Reason" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => onSubmit(text.trim())}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

