ALTER TABLE public.claims ADD COLUMN assigned_agent text NOT NULL DEFAULT 'Alex Rivera';
ALTER TABLE public.claims ADD COLUMN submitted_at timestamptz;
ALTER TABLE public.demo_claims_snapshot ADD COLUMN assigned_agent text NOT NULL DEFAULT 'Alex Rivera';
ALTER TABLE public.demo_claims_snapshot ADD COLUMN submitted_at timestamptz;
UPDATE public.claims SET assigned_agent = CASE id WHEN 'CLM-24-10422' THEN 'Jordan Chen' WHEN 'CLM-24-10424' THEN 'Jordan Chen' WHEN 'CLM-24-10425' THEN 'Taylor Vance' WHEN 'CLM-24-10426' THEN 'Taylor Vance' ELSE 'Alex Rivera' END;
UPDATE public.demo_claims_snapshot SET assigned_agent = CASE id WHEN 'CLM-24-10422' THEN 'Jordan Chen' WHEN 'CLM-24-10424' THEN 'Jordan Chen' WHEN 'CLM-24-10425' THEN 'Taylor Vance' WHEN 'CLM-24-10426' THEN 'Taylor Vance' ELSE 'Alex Rivera' END;