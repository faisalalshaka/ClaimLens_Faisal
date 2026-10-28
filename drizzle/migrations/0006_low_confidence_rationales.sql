DO $$
DECLARE
  pairs text[][] := ARRAY[
    ARRAY['Mirror housing appears broken and glass missing.', 'Mirror housing appears broken and glass missing; the mirror is only partly in frame, so the full extent is uncertain.'],
    ARRAY['Dent visible on the fender above the wheel arch.', 'Dent visible on the fender above the wheel arch; low night lighting makes the dent depth hard to judge.'],
    ARRAY['Hairline crack in the headlight lens.', 'Hairline crack in the headlight lens; a crack this fine is hard to tell apart from reflections at this distance.']
  ];
  p text[];
BEGIN
  FOREACH p SLICE 1 IN ARRAY pairs LOOP
    UPDATE public.claims SET
      line_items = replace(line_items::text, to_jsonb(p[1])::text, to_jsonb(p[2])::text)::jsonb,
      ai_line_items = replace(ai_line_items::text, to_jsonb(p[1])::text, to_jsonb(p[2])::text)::jsonb;
    UPDATE public.claims SET
      line_items = replace(line_items::text, '"' || p[1] || '\n', '"' || p[2] || '\n')::jsonb;
    UPDATE public.demo_claims_snapshot SET
      line_items = replace(line_items::text, to_jsonb(p[1])::text, to_jsonb(p[2])::text)::jsonb,
      ai_line_items = replace(ai_line_items::text, to_jsonb(p[1])::text, to_jsonb(p[2])::text)::jsonb;
  END LOOP;
END $$;