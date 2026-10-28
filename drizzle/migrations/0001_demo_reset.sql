CREATE TABLE public.demo_claims_snapshot AS
SELECT * FROM public.claims WHERE id LIKE 'CLM-24-%';
UPDATE public.demo_claims_snapshot SET
  status = 'Ready for agent review', line_items = ai_line_items, agent_notes = '',
  rejection_reason = NULL, photo_request_reason = NULL, approved_at = NULL
WHERE id IN ('CLM-24-10421','CLM-24-10422','CLM-24-10425');
ALTER TABLE public.demo_claims_snapshot ADD PRIMARY KEY (id);
GRANT ALL ON public.demo_claims_snapshot TO service_role;
ALTER TABLE public.demo_claims_snapshot ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reset_demo()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.claims WHERE id NOT IN (SELECT id FROM public.demo_claims_snapshot);
  DELETE FROM public.claims WHERE id IN (SELECT id FROM public.demo_claims_snapshot);
  INSERT INTO public.claims SELECT * FROM public.demo_claims_snapshot;
END $$;
GRANT EXECUTE ON FUNCTION public.reset_demo() TO anon, authenticated;