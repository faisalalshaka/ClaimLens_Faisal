import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ACTIONS, DAMAGE_TYPES, PARTS, PHOTO_ISSUES, SEVERITIES, aiResultIsCurrent, applyContextRecheck, analyzablePhotoIndices, keepSeniorFlags, mergeAddedPhotoResult, newPhotoPositions, uploadedPhotoIndices, type AiResult, type LineItem } from "./claims";

const SYSTEM = `You are an auto insurance damage assessor. You receive one or more photos of a damaged vehicle (photo_index starts at 0, in the order given).
Return strict JSON matching the schema.
Rules:
- Never output prices.
- Report quality for every photo. If a photo is unusable, mark usable=false and give the issue (blurry, too dark, vehicle not visible, no damage visible).
- If no photo can be assessed, set can_assess=false and return no line items.
- Set requires_inspection=true for structural deformation, or for severe front-end or frame-adjacent damage, and give a short reason; otherwise reason is null.
- One line item per distinct damaged part per photo. bbox is [ymin, xmin, ymax, xmax] normalized 0–1000 on that photo.
- confidence is 0.0–1.0. rationale is one short sentence.
- Whenever confidence is below 0.8, the rationale MUST name what limits certainty after a semicolon — e.g. glare, reflections, low light, blur, camera angle, distance, part only partly in frame, dirt or shadow hiding the surface. Example: "Possible crack at the fender edge; glare limits certainty."
- Compare the customer's accident description with the damage in the photos. If the photos show damage to a clearly different area of the vehicle than described (e.g. described front impact but damage is on the rear/trunk, or left side vs right side), set narrative_mismatch=true and give one short sentence naming what was described versus what the photos show. If the description is vague, generic, or consistent with the photos, set narrative_mismatch=false and reason null. Still list the damage you actually see.
- Check vehicle identity. You are told the insured vehicle (year, make, model). For each photo, judge the visible body style (sedan, hatchback, SUV, truck…), paint color, badges, lights and trim. If any assessed photo clearly shows a different vehicle than the insured one (e.g. a hatchback when a sedan is insured, a different make's styling), or a different vehicle than the reference photo already on the claim (different paint color or body style), set vehicle_mismatch=true, list the photo_index of each mismatched photo in vehicle_mismatch_photos, and give one short sentence that starts with a verb (e.g. "shows a silver hatchback rather than the insured sedan") — do not mention photo numbers in that sentence. A visible manufacturer badge or emblem of a different make than the insured vehicle (e.g. a BMW roundel, Honda "H" or Ford oval on a claim for a Toyota), or brand-specific styling such as a BMW kidney grille, is ALWAYS a mismatch — check this before anything else, even when the photo shows heavy damage. Do NOT create line items, and do NOT set requires_inspection or narrative_mismatch, based on photos of a different vehicle. If the vehicle is consistent or cannot be judged (close-up of a single panel), set vehicle_mismatch=false, vehicle_mismatch_photos=[] and reason null.
- Each image is preceded by a label like "Photo 3 (photo_index 0)". When a reason sentence refers to a specific photo, use that label's "Photo N" number, never the photo_index.`;

const schema = z.object({
  photo_quality: z.array(
    z.object({ photo_index: z.number(), usable: z.boolean(), issue: z.enum(PHOTO_ISSUES).nullable() }),
  ),
  can_assess: z.boolean(),
  requires_inspection: z.boolean(),
  requires_inspection_reason: z.string().nullable(),
  narrative_mismatch: z.boolean(),
  narrative_mismatch_reason: z.string().nullable(),
  vehicle_mismatch: z.boolean(),
  vehicle_mismatch_photos: z.array(z.number()),
  vehicle_mismatch_reason: z.string().nullable(),
  line_items: z.array(
    z.object({
      photo_index: z.number(),
      part: z.enum(PARTS),
      damage_type: z.enum(DAMAGE_TYPES),
      severity: z.enum(SEVERITIES),
      action: z.enum(ACTIONS),
      confidence: z.number(),
      bbox: z.array(z.number()),
      rationale: z.string(),
    }),
  ),
});

export const analyzeClaim = createServerFn({ method: "POST" })
  .inputValidator((input: { claimId: string; markReady: boolean; resetReview?: boolean }) => input)
  .handler(async ({ data }): Promise<{ ok: true; unchanged?: boolean; added?: number } | { ok: false; error: string }> => {
    const { createClient } = await import("@supabase/supabase-js");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText, Output } = await import("ai");

    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });

    const { data: claim, error } = await sb.from("claims").select("*").eq("id", data.claimId).single();
    if (error || !claim) return { ok: false, error: "Claim not found" };
    const allPhotos = (claim.photos as (string | null)[]) ?? [];
    const uploaded = uploadedPhotoIndices(allPhotos);
    if (!uploaded.length) return { ok: false, error: "Upload at least one photo before running AI analysis." };
    // Older uploads may be in formats the AI can't read (e.g. AVIF/HEIC); skip them and flag them on the claim.
    const positions = analyzablePhotoIndices(allPhotos);
    const skipped = uploaded.filter((i) => !positions.includes(i));
    if (!positions.length)
      return { ok: false, error: "The AI can't read these photo files. Please upload the photos again as JPG or PNG." };
    const paths = positions.map((i) => allPhotos[i]!);

    // Same photos as the saved assessment → keep the AI's assessment exactly (confidence, items). AI output is not
    // deterministic, so re-asking about unchanged evidence would only produce noise. A confirmed re-run
    // (resetReview) restores the agent's review to that original assessment.
    if (aiResultIsCurrent(claim.ai_result as AiResult | null, allPhotos)) {
      const update: Record<string, unknown> = {};
      if (data.resetReview) update["line_items"] = keepSeniorFlags((claim.ai_line_items as LineItem[] | null) ?? [], (claim.line_items as LineItem[] | null) ?? []);
      if (data.markReady) {
        update["status"] = "Ready for agent review";
        update["photo_request_reason"] = null;
      }
      if (Object.keys(update).length) {
        const { error: upErr } = await sb.from("claims").update({ ...update, updated_at: new Date().toISOString() }).eq("id", data.claimId);
        if (upErr) return { ok: false, error: "Could not update the claim." };
      }
      return { ok: true, unchanged: true };
    }

    // Only new photos since the last analysis → the AI looks at just those and its findings are added to the
    // existing line items, so the agent's review work stays. Otherwise every photo is analyzed afresh.
    const prev = claim.ai_result as AiResult | null;
    const added = newPhotoPositions(prev, allPhotos);
    const incremental = !!prev && !!added && added.length > 0;
    const sendPositions = incremental ? added! : positions;
    const sendPaths = sendPositions.map((i) => allPhotos[i]!);
    const prevAi = (claim.ai_line_items as LineItem[] | null) ?? [];
    const known = incremental
      ? `\nDamage already recorded from earlier photos (do not list it again unless these photos show a different part): ${
          prevAi.map((i) => `${i.part} (${i.damage_type})`).join(", ") || "none"}.`
      : "";

    const { data: signed } = await sb.storage.from("claim-photos").createSignedUrls(sendPaths, 600);
    const urls = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
    // Incremental runs also get one already-analyzed photo as a vehicle reference (not re-assessed), so the AI can
    // tell when a newly added photo shows a different car.
    const flagged = new Set((prev?.vehicle_mismatches ?? []).map((m) => m.path));
    const refPath = incremental ? (prev!.analyzed_photos ?? []).find((p) => !sendPaths.includes(p) && !flagged.has(p)) : undefined;
    const refUrl = refPath ? (await sb.storage.from("claim-photos").createSignedUrl(refPath, 600)).data?.signedUrl : undefined;
    const vehicle = `${claim.vehicle_year} ${claim.vehicle_make} ${claim.vehicle_model}`;
    const refNote = refUrl
      ? `\nThe LAST image is a reference photo of the insured vehicle already on the claim — use it only to compare vehicle identity (color, body style); do not report quality or line items for it.`
      : "";

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false, error: "AI is not configured." };
    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    // streamText reports the real API failure through onError; the thrown error is only "no output generated".
    let streamError: unknown = null;
    try {
      const result = streamText({
        onError: ({ error }: { error: unknown }) => {
          streamError = error;
        },
        model: provider.responses("openai/gpt-6-astra"),
        instructions: SYSTEM,
        output: Output.object({ schema }),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Insured vehicle: ${vehicle}\nAccident description: ${claim.description}${known}\nAssess these ${urls.length} photo(s) (photo_index 0–${urls.length - 1}).${refNote}` },
              // Label each image with the number the agent sees on the claim (P1, P2…), so reasons cite the right photo.
              ...urls.flatMap((u, n) => [
                { type: "text" as const, text: `Photo ${sendPositions[n]! + 1} (photo_index ${n}):` },
                { type: "image" as const, image: new URL(u) },
              ]),
              ...(refUrl ? [{ type: "text" as const, text: "Reference photo (not assessed):" }, { type: "image" as const, image: new URL(refUrl) }] : []),
            ],
          },
        ],
        maxRetries: 0,
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      } as Parameters<typeof streamText>[0]);
      const out = schema.parse(JSON.parse(await (result as unknown as { text: PromiseLike<string> }).text));
      // Ignore anything the AI reports for the reference photo (it sits after the photos being assessed).
      const inRange = (n: number) => Math.round(n) < sendPositions.length;
      out.photo_quality = out.photo_quality.filter((q) => inRange(q.photo_index));
      out.line_items = out.line_items.filter((i) => inRange(i.photo_index));

      // The AI sees only uploaded photos, in order; map its photo numbers back to the claim's photo positions.
      const toPos = (n: number) => sendPositions[Math.max(0, Math.min(sendPositions.length - 1, Math.round(n)))] ?? 0;
      const prevQuality = new Set((prev?.photo_quality ?? []).map((q) => q.photo_index));
      out.photo_quality = [
        ...out.photo_quality.map((q) => ({ ...q, photo_index: toPos(q.photo_index) })),
        ...skipped.filter((i) => !incremental || !prevQuality.has(i)).map((i) => ({ photo_index: i, usable: false, issue: "file format the AI can't read — re-upload as JPG or PNG" as never })),
      ].sort((a, b) => a.photo_index - b.photo_index);
      const clamp = (n: number) => Math.max(0, Math.min(1000, Math.round(n)));
      const items = out.can_assess
        ? out.line_items.map((i, idx) => {
            const b = [...i.bbox, 0, 0, 1000, 1000].slice(0, 4).map(clamp) as [number, number, number, number];
            return {
              ...i,
              photo_index: toPos(i.photo_index),
              id: `ai-${Date.now().toString(36)}-${idx}`,
              confidence: Math.max(0, Math.min(1, i.confidence)),
              bbox: [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])],
            };
          })
        : [];
      const { line_items: _li, vehicle_mismatch_photos: vmPhotos, ...aiResult } = out;
      // Record mismatched photos by file, so the warning can name each by its current number on the claim.
      const vmPos = new Set(vmPhotos.filter(inRange).map(toPos));
      if (aiResult.vehicle_mismatch && !vmPos.size && sendPositions.length === 1) vmPos.add(sendPositions[0]!);
      const reason = (aiResult.vehicle_mismatch_reason ?? "shows a different vehicle than the insured one").replace(/^\s*(the\s+)?photo(\s+\d+)?\s*/i, "");
      const vehicle_mismatches = aiResult.vehicle_mismatch ? [...vmPos].map((i) => ({ path: allPhotos[i]!, reason })) : [];
      Object.assign(aiResult, { vehicle_mismatch: vehicle_mismatches.length > 0 || aiResult.vehicle_mismatch, vehicle_mismatches });
      // A photo of someone else's car says nothing about this claim: drop its line items, and if every photo in this
      // run was of another vehicle, drop the inspection and description findings it would otherwise have raised.
      const ownItems = items.filter((i) => !vmPos.has(i.photo_index));
      items.splice(0, items.length, ...ownItems);
      if (vmPos.size && sendPositions.every((i) => vmPos.has(i))) {
        Object.assign(aiResult, { requires_inspection: false, requires_inspection_reason: null, narrative_mismatch: false, narrative_mismatch_reason: null });
      }
      const aiItems = incremental ? [...prevAi, ...items] : items;
      const update: Record<string, unknown> = incremental
        ? {
            ai_result: mergeAddedPhotoResult(prev!, aiResult, allPhotos, sendPaths),
            ai_line_items: aiItems,
            line_items: data.resetReview ? keepSeniorFlags(aiItems as LineItem[], (claim.line_items as LineItem[] | null) ?? []) : [...((claim.line_items as LineItem[] | null) ?? []), ...items],
          }
        : { ai_result: { ...aiResult, analyzed_photos: paths }, ai_line_items: items, line_items: items };
      update["updated_at"] = new Date().toISOString();
      if (data.markReady) {
        update["status"] = "Ready for agent review";
        update["photo_request_reason"] = null;
      }
      const { error: upErr } = await sb.from("claims").update(update).eq("id", data.claimId);
      if (upErr) return { ok: false, error: "Could not save the analysis." };
      return incremental ? { ok: true, added: items.length } : { ok: true };
    } catch (e) {
      const cause = (streamError ?? e) as { statusCode?: number; message?: string };
      const status = cause.statusCode;
      console.error("AI analysis failed", cause);
      if (status === 400 && /valid image|image format|image data/i.test(cause.message ?? ""))
        return { ok: false, error: "One of the photos couldn't be read by the AI. Please re-upload it as a JPG or PNG." };
      if (status === 402) return { ok: false, error: "AI credits are exhausted. Add credits in Settings → Plans & credits." };
      if (status === 429) return { ok: false, error: "AI is rate limited. Please try again in a minute." };
      if (status === 403) return { ok: false, error: "AI access was denied for this request." };
      return { ok: false, error: "AI analysis failed. Please try again." };
    }
  });

const RECHECK_SYSTEM = `You are an auto insurance damage assessor. The claim's intake details were just corrected by the agent. Re-check ONLY whether the photos are consistent with the corrected details. Do not assess damage, prices or photo quality. Return strict JSON matching the schema.
Each image is preceded by a label like "Photo 3 (photo_index 0)"; photo_index starts at 0 in the order given.
- Vehicle identity (only when asked): judge each photo's body style, paint color and badges against the insured vehicle (make, model). A visible badge or brand-specific styling of a different make (e.g. a BMW roundel or kidney grille on a claim for a Toyota), a clearly different body style (hatchback vs sedan vs SUV vs truck) or a different paint color than the other photos is a mismatch. Model-year, generation, facelift or trim differences are NOT a mismatch. List each mismatched photo_index in vehicle_mismatch_photos and give one short reason sentence that starts with "shows" (e.g. "shows a silver hatchback rather than the insured sedan"), without photo numbers. If consistent or impossible to judge, return [] and null. When told the vehicle details are unchanged, always return [] and null.
- Description: compare the accident description with the damage in the photos of the insured vehicle only (ignore mismatched photos). If the photos show damage to a clearly different area than described (front vs rear/trunk, left vs right side), set narrative_mismatch=true and give one short sentence naming what was described versus what the photos show, citing photos by their "Photo N" label. If the description is vague, generic or consistent, set narrative_mismatch=false and reason null.`;

const recheckSchema = z.object({
  vehicle_mismatch_photos: z.array(z.number()),
  vehicle_mismatch_reason: z.string().nullable(),
  narrative_mismatch: z.boolean(),
  narrative_mismatch_reason: z.string().nullable(),
});

/**
 * After the agent corrects the claim's description or vehicle, re-run only the AI's description and vehicle checks
 * on the photos already analyzed. Line items, confidence and review work stay exactly as they are.
 */
export const recheckClaimContext = createServerFn({ method: "POST" })
  .inputValidator((input: { claimId: string; vehicleChanged: boolean }) => input)
  .handler(async ({ data }): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }> => {
    const { createClient } = await import("@supabase/supabase-js");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText, Output } = await import("ai");

    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });

    const { data: claim, error } = await sb.from("claims").select("*").eq("id", data.claimId).single();
    if (error || !claim) return { ok: false, error: "Claim not found" };
    const prev = claim.ai_result as AiResult | null;
    const allPhotos = (claim.photos as (string | null)[]) ?? [];
    // Only photos the AI already assessed; nothing to re-check before the first analysis. When the vehicle wasn't
    // edited, its identity warnings stand and photos of another car are left out of the description check.
    const flagged = new Set(data.vehicleChanged ? [] : (prev?.vehicle_mismatches ?? []).map((m) => m.path));
    const positions = analyzablePhotoIndices(allPhotos).filter((i) => prev?.analyzed_photos?.includes(allPhotos[i]!) && !flagged.has(allPhotos[i]!));
    if (!prev || !positions.length) {
      if (prev && flagged.size) {
        const ai_result = applyContextRecheck(prev, { narrative_mismatch: false, narrative_mismatch_reason: null, vehicle_mismatches: prev.vehicle_mismatches ?? [] });
        await sb.from("claims").update({ ai_result, updated_at: new Date().toISOString() }).eq("id", data.claimId);
      }
      return { ok: true, skipped: true };
    }
    const paths = positions.map((i) => allPhotos[i]!);

    const { data: signed } = await sb.storage.from("claim-photos").createSignedUrls(paths, 600);
    const urls = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
    if (urls.length !== paths.length) return { ok: false, error: "Could not load the claim photos." };

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false, error: "AI is not configured." };
    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    let streamError: unknown = null;
    try {
      const result = streamText({
        onError: ({ error }: { error: unknown }) => {
          streamError = error;
        },
        model: provider.responses("openai/gpt-6-astra"),
        instructions: RECHECK_SYSTEM,
        output: Output.object({ schema: recheckSchema }),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Insured vehicle: ${claim.vehicle_year} ${claim.vehicle_make} ${claim.vehicle_model}\nAccident description: ${claim.description}\n${data.vehicleChanged ? "The vehicle details were edited: check vehicle identity." : "The vehicle details are unchanged: check only the description."}\nRe-check these ${urls.length} photo(s) (photo_index 0–${urls.length - 1}).` },
              ...urls.flatMap((u, n) => [
                { type: "text" as const, text: `Photo ${positions[n]! + 1} (photo_index ${n}):` },
                { type: "image" as const, image: new URL(u) },
              ]),
            ],
          },
        ],
        maxRetries: 0,
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      } as Parameters<typeof streamText>[0]);
      const out = recheckSchema.parse(JSON.parse(await (result as unknown as { text: PromiseLike<string> }).text));
      const mismatched = [...new Set(out.vehicle_mismatch_photos.map((n) => Math.round(n)).filter((n) => n >= 0 && n < paths.length))];
      const reason = (out.vehicle_mismatch_reason ?? "shows a different vehicle than the insured one")
        .replace(/^\s*(the\s+)?photos?(\s+\d+)?\s*/i, "")
        .replace(/^show\b/i, "shows");
      const allOther = mismatched.length === paths.length;
      const vehicle_mismatches = data.vehicleChanged
        ? mismatched.map((n) => ({ path: paths[n]!, reason }))
        : (prev.vehicle_mismatches ?? []);
      const ai_result = applyContextRecheck(prev, {
        narrative_mismatch: out.narrative_mismatch && !(data.vehicleChanged && allOther),
        narrative_mismatch_reason: out.narrative_mismatch_reason,
        vehicle_mismatches,
      });
      const { error: upErr } = await sb.from("claims").update({ ai_result, updated_at: new Date().toISOString() }).eq("id", data.claimId);
      if (upErr) return { ok: false, error: "Could not save the re-check." };
      return { ok: true };
    } catch (e) {
      const cause = (streamError ?? e) as { statusCode?: number; message?: string };
      console.error("AI re-check failed", cause);
      if (cause.statusCode === 402) return { ok: false, error: "AI credits are exhausted. Add credits in Settings → Plans & credits." };
      if (cause.statusCode === 429) return { ok: false, error: "AI is rate limited. Please try again in a minute." };
      if (cause.statusCode === 403) return { ok: false, error: "AI access was denied for this request." };
      return { ok: false, error: "The AI couldn't re-check the photos against the new details." };
    }
  });
