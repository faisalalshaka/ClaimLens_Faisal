<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Pricing is computed client-side from the repair_costs table via src/lib/claims.ts (never from AI) — keeps estimates deterministic and testable.
- AI damage analysis runs only in src/lib/analyze.functions.ts (server fn) — keeps the AI key server-side.
- No auth by design: claims/storage policies allow anon access for this internal demo tool.
- Store line-item review decisions and manual override metadata in each claim's line_items JSON; retain rejected items but exclude them from payable estimates to preserve the audit trail.
- Share the demo shop recommendation component across review and authorization views so both roles see the same list.
- Group senior review changes by line-item ID in the presentation layer and keep detailed differences expandable; preserve the underlying audit records.
- Claim photo positions are stable (photos array index = line item photo_index); the AI sees only uploaded photos, so analyze.functions.ts maps its indices back to array positions.
- KPIs are computed from raw counts (kpiCounts/kpisFromCounts in src/lib/claims.ts), including per-section override counts (sectionOverrides) behind the override-rate breakdown, and agent views live in src/lib/agents.ts — summing counts keeps team totals correctly weighted when live claims are combined with sample agent history; sample sectionOverrides must sum to overriddenFields.
- Every KPI counts only handed-off claims (Submitted to senior or Approved); drafts in the junior queue, including returned ones, are excluded — work in progress must not make the metrics swing.
- analyze.functions.ts reuses the saved AI result when the claim's AI-readable photos match ai_result.analyzed_photos — AI output isn't deterministic, so unchanged evidence must not change confidence or items; when only new photos were added (newPhotoPositions), it sends just those and appends their items to ai_line_items and line_items so review work is kept. Agent-added photos are tracked in ai_result.added_photos and stay deletable with their items.
- Time to submit is claims.active_review_seconds, a stopwatch accumulated only while the junior agent has the claim open and visible (paused when they leave, kept across returns and photo requests so revisions add to the total) — queue and customer wait time isn't agent work.
- Other agents' approved claims are static view-only samples in src/lib/agents.ts (SAMPLE_APPROVED) kept consistent with their KPI history — the demo's interactive workflow is Alex Rivera's only.
- Line items render as a CSS grid (ITEM_COLS in claims.$claimId.tsx, rationale on a second row) with shrinkable minmax(0,…) columns — the review list must never scroll sideways beside the photos.
- Agent feedback on an AI line item is stored inside its rationale string after AGENT_FEEDBACK_MARK (splitRationale/joinRationale in src/lib/claims.ts) — keeps the existing override, revert and audit diff logic working on one field.
- Repair & settlement tracking is browser-local per claim (src/lib/settlement.ts); Reset demo clears all of it and a new approval clears that claim's, so a re-approved claim never shows stale progress. Shop quote files go to the claim-photos bucket under quotes/ and are never sent to the AI.
- Senior revision requests live per line item in line_items JSON (senior_flag: note, at, resolved) and are drafted in page state until Return — notes are resolved, not deleted, on resubmission so the audit trail survives; revert and AI re-runs carry them over (keepSeniorFlags). Return clears the flagged items' Accept/Reject decision (values kept) so the agent must re-decide each one before resubmitting — no rubber-stamping.
- Claims auto-closed for 30-day customer inactivity use status "Closed – inactive" (CLOSED_INACTIVE in src/lib/claims.ts); they're excluded from the queue and KPIs, and Reopen resets created_at/active time so dormancy never skews turnaround.

- Description-vs-photo mismatch is an AI output (ai_result.narrative_mismatch + reason) shown as a warning banner only — it flags for the human, never changes line items or pricing.
- Editing a claim's description or vehicle runs recheckClaimContext (analyze.functions.ts), which redoes only the description check (and the vehicle check when the vehicle changed) and replaces those warnings via applyContextRecheck — line items and review work stay untouched, so edits never cost the agent their review.
