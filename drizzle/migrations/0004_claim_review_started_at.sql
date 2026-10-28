ALTER TABLE public.claims ADD COLUMN review_started_at timestamptz;
ALTER TABLE public.demo_claims_snapshot ADD COLUMN review_started_at timestamptz;