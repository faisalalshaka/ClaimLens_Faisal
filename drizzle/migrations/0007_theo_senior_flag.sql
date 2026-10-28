UPDATE public.claims SET rejection_reason = '1 line item flagged for revision: #1 Front Bumper',
  line_items = jsonb_set(line_items, '{0,senior_flag}', jsonb_build_object('note', 'Front bumper should be repair, not replace – the scuffs are minor and paint-matchable. Customer OEM preference isn''t covered; please change Action back to Repair.', 'at', to_char(coalesce(submitted_at, now()) + interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'resolved', false))
WHERE id = 'CLM-24-10426';
UPDATE public.demo_claims_snapshot SET rejection_reason = '1 line item flagged for revision: #1 Front Bumper',
  line_items = jsonb_set(line_items, '{0,senior_flag}', jsonb_build_object('note', 'Front bumper should be repair, not replace – the scuffs are minor and paint-matchable. Customer OEM preference isn''t covered; please change Action back to Repair.', 'at', to_char(coalesce(submitted_at, now()) + interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'resolved', false))
WHERE id = 'CLM-24-10426';