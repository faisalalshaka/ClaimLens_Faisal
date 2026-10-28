# ClaimLens — AI-Assisted Vehicle Damage Assessment

ClaimLens is an internal claims console prototype. A junior claim agent opens a claim, collects damage photos, gets an AI damage assessment, reviews every finding, and submits a priced estimate to a senior adjuster for sign-off. The goal is to show how AI can speed up auto claims **while humans stay in control and every decision stays auditable**.

## Problem

Manual damage assessment is slow and inconsistent, but "the AI said so" is not acceptable for a financial decision. ClaimLens treats the model as a fast first draft: it proposes findings with confidence and reasoning, and people approve, correct or reject them.

## Core user flow

1. **Start a claim** — `+ New claim` (policyholder, vehicle make from a dropdown, accident date that can't be in the future, description). The claim starts at *Awaiting customer photos*.
2. **Upload photos** — any number, any order; photos the agent uploaded can be removed.
3. **AI assessment** — the vision model returns line items (part, damage, severity, action, labor hours), a confidence score and an evidence-based reason for each.
4. **Junior review** — accept, edit (with a reason) or reject (with a reason) each item; add missed items; request more photos.
5. **Senior review** — sees changes grouped by line item, can flag items for revision and return the claim, or approve it.
6. **Authorization & settlement** — customer-facing summary, recommended repair shops, and repair/payment tracking.

## Key design decisions

| Decision | Why |
|---|---|
| **Pricing is deterministic** (repair cost table + $50/hour labor), never from the AI | Estimates must be repeatable and testable; the model only identifies damage. |
| **AI findings are never deleted** — rejected items are kept but left out of the total | Full audit trail of what the model said versus what people decided. |
| **Every finding explains itself**; items under 80% confidence also get an uncertainty note | Catches "right answer, wrong reason" without alert fatigue. |
| **Narrative vs. photo check** (e.g. front-bumper report, rear damage photos) | Warning only — flags for a human, never changes the estimate. |
| **Vehicle identity check** (make, model, color, prior photos) | Flags photos of a different car (e.g. a BMW on a Toyota claim) and ignores their damage. |
| **Data minimization** — the model gets vehicle and accident details, not personal data | Fraud signals without exposing customer information. |
| **Incremental analysis** — only new photos are sent; unchanged evidence reuses the saved result | Lower cost and latency, and stable results for reviewers. |
| **Separate junior and senior workflows** | Mirrors real separation of duties for financial authority. |
| **Truthful KPIs** — override rate, clean acceptance, missed items, active review time, turnaround | Active time counts only while the agent has the claim open, not queue or customer wait. |
| **Override drill-down** — clicking the AI override rate opens a breakdown across 7 sections (Part, Damage, Severity, Action, Labor, Parts price, Rationale) | Shows where the vision model is corrected most, so tuning effort goes where it matters. |
| **Draft-safe KPI counting** — metrics include only claims submitted to the senior adjuster or approved | In-progress drafts and returned claims are work in progress and must not skew the numbers. |

## Intentional scope cuts

- No login — roles are switched in the header for the demo.
- Repair shops are fictional examples; shop selection happens after approval.
- Repair & settlement tracking is stored in the browser.
- Queue order is a demo progression of scenarios; production priority rules (SLA, risk, customer touchpoints) would be agreed with the carrier.

## Demo scenarios

Use **Reset demo** to restore the seeded claims. Included cases cover a clean claim, low-confidence findings, a claim requiring inspection, a senior return with revision notes, an approved claim with settlement tracking, and an inactive closed claim that can be reopened.

## Architecture

- **App:** TanStack Start (React 19, TypeScript), Tailwind CSS.
- **Backend:** PostgreSQL database and secure object storage (Supabase / Lovable Cloud) for claims, deterministic repair rate tables, and private photo and shop quote storage.
- **AI:** OpenAI GPT vision model (`openai/gpt-6-astra`), called from a server-side function through the Lovable AI Gateway with a structured output schema; the AI key never reaches the browser and the model can be swapped at the gateway.
- **Tests:** Vitest unit tests for pricing, KPIs, senior flags, settlement and vehicle-mismatch logic.

## Run locally

```sh
npm i
npm run dev      # start the app
npx vitest run   # run tests
```
