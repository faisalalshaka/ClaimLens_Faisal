import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { updateClaim } from "@/lib/data";
import { recheckClaimContext } from "@/lib/analyze.functions";
import { intakeContextChanged, isFutureDate, newClaimId, newClaimRecord, todayISO, type Claim, type NewClaimInput } from "@/lib/claims";

// The 20 best-selling car brands, alphabetical — a quick pick list for the demo's claim intake.
const CAR_MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Chevrolet", "Ford", "GMC", "Honda", "Hyundai", "Jeep", "Kia",
  "Lexus", "Mazda", "Mercedes-Benz", "Nissan", "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen",
];

function readForm(form: HTMLFormElement): NewClaimInput {
  const f = new FormData(form);
  return {
    policyholder: String(f.get("name")).trim(),
    policy_number: String(f.get("policy")).trim(),
    vehicle_year: Number(f.get("year")),
    vehicle_make: String(f.get("make")).trim(),
    vehicle_model: String(f.get("model")).trim(),
    accident_date: String(f.get("date")),
    description: String(f.get("desc")).trim(),
  };
}

export function NewClaimDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = readForm(e.currentTarget);
    if (isFutureDate(input.accident_date)) {
      toast.error("Accident date can't be in the future.");
      return;
    }
    const id = newClaimId();
    const record = newClaimRecord(input, id);
    setBusy(true);
    try {
      const { error } = await supabase.from("claims").insert(record as never);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["claims"] });
      toast.success(`${id} created · customer notified to upload damage photos`);
      setOpen(false);
      navigate({ to: "/claims/$claimId", params: { claimId: id } });
    } catch (err) {
      console.error(err);
      toast.error("Could not create the claim.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4" /> New claim</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New claim</DialogTitle>
          <DialogDescription className="text-[13px]">
            The claim starts as "Awaiting customer photos" and the customer is notified to upload photos of the damage.
          </DialogDescription>
        </DialogHeader>
        <ClaimForm onSubmit={submit} busy={busy} submitLabel="Create & notify customer" busyLabel="Creating…" />
      </DialogContent>
    </Dialog>
  );
}

/** Junior agents can correct the intake details they typed in; photos, line items and review work are untouched. */
export function EditClaimDialog({ claim }: { claim: Claim }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const recheck = useServerFn(recheckClaimContext);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = readForm(e.currentTarget);
    if (isFutureDate(input.accident_date)) {
      toast.error("Accident date can't be in the future.");
      return;
    }
    // The AI's description and vehicle checks were made against the old details; re-check them after saving.
    const needsRecheck = !!claim.ai_result?.analyzed_photos?.length && intakeContextChanged(claim, input as Claim);
    const vehicleChanged = intakeContextChanged({ ...claim, description: "" }, { ...(input as Claim), description: "" });
    setBusy(true);
    try {
      await updateClaim(claim.id, input as Partial<Claim>);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["claims"] }),
        qc.invalidateQueries({ queryKey: ["claim", claim.id] }),
      ]);
      toast.success(`${claim.id} details updated`);
      setOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Could not save the changes.");
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!needsRecheck) return;
    const t = toast.loading("Re-checking the photos against the updated details…");
    try {
      const res = await recheck({ data: { claimId: claim.id, vehicleChanged } });
      if (!res.ok) throw new Error(res.error);
      await qc.invalidateQueries({ queryKey: ["claim", claim.id] });
      toast.success("AI warnings updated for the new details", { id: t });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "The AI couldn't re-check the photos.", { id: t });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Edit claim details"
          title="Edit claim details"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit claim details</DialogTitle>
          <DialogDescription className="text-[13px]">
            Correct anything entered incorrectly. Photos, line items and review work stay as they are; if you change the vehicle or description, the AI re-checks its warnings against the new details.
          </DialogDescription>
        </DialogHeader>
        <ClaimForm initial={claim} onSubmit={submit} busy={busy} submitLabel="Save edits" busyLabel="Saving…" />
      </DialogContent>
    </Dialog>
  );
}

function ClaimForm({
  initial,
  onSubmit,
  busy,
  submitLabel,
  busyLabel,
}: {
  initial?: NewClaimInput;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  submitLabel: string;
  busyLabel: string;
}) {
  const makes = initial?.vehicle_make && !CAR_MAKES.includes(initial.vehicle_make) ? [...CAR_MAKES, initial.vehicle_make].sort() : CAR_MAKES;
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 text-[13px]">
      <Field label="Policyholder" name="name" defaultValue={initial?.policyholder} />
      <Field label="Policy number" name="policy" placeholder="PA-000000" defaultValue={initial?.policy_number} />
      <Field label="Year" name="year" type="number" placeholder="2022" min={1950} max={2030} defaultValue={initial?.vehicle_year} />
      <div className="space-y-1">
        <Label htmlFor="make">Make</Label>
        <select
          id="make"
          name="make"
          required
          defaultValue={initial?.vehicle_make ?? ""}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="" disabled>Select make</option>
          {makes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <Field label="Model" name="model" defaultValue={initial?.vehicle_model} />
      <Field label="Accident date" name="date" type="date" max={todayISO()} defaultValue={initial?.accident_date} />
      <div className="col-span-2 space-y-1">
        <Label htmlFor="desc">Accident description</Label>
        <Textarea id="desc" name="desc" required rows={2} maxLength={1000} defaultValue={initial?.description} />
      </div>
      <div className="col-span-2 flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {busyLabel}</> : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, name, type = "text", placeholder, min, max, defaultValue }: { label: string; name: string; type?: string; placeholder?: string; min?: number; max?: number | string; defaultValue?: string | number | undefined }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} placeholder={placeholder} min={min} max={max} defaultValue={defaultValue} maxLength={type === "text" ? 100 : undefined} required className="h-9" />
    </div>
  );
}
