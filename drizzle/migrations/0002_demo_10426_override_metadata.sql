UPDATE public.demo_claims_snapshot
SET line_items = (
  SELECT jsonb_agg(
    CASE
      WHEN li->>'id' = 'f1' THEN li || jsonb_build_object(
        'overridden_fields', jsonb_build_array('action'),
        'override_reasons', jsonb_build_object('action', 'Customer prefers OEM parts; replacing due to paint mismatch risk.'),
        'manual_override_reason', 'Customer prefers OEM parts; replacing due to paint mismatch risk.')
      WHEN li->>'id' = 'f2' THEN li || jsonb_build_object(
        'overridden_fields', jsonb_build_array('price_override'),
        'override_reasons', jsonb_build_object('price_override', li->>'override_reason'),
        'manual_override_reason', li->>'override_reason')
      ELSE li
    END ORDER BY ord)
  FROM jsonb_array_elements(line_items) WITH ORDINALITY AS t(li, ord)
)
WHERE id = 'CLM-24-10426';

UPDATE public.claims c
SET line_items = s.line_items, status = s.status, agent_notes = s.agent_notes, rejection_reason = s.rejection_reason
FROM public.demo_claims_snapshot s
WHERE c.id = s.id AND c.id = 'CLM-24-10426';