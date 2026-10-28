ALTER TABLE public.claims ADD COLUMN active_review_seconds integer NOT NULL DEFAULT 0;
ALTER TABLE public.demo_claims_snapshot ADD COLUMN active_review_seconds integer NOT NULL DEFAULT 0;