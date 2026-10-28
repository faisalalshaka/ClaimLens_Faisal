create table public.repair_costs (
  part text not null,
  action text not null check (action in ('repair','replace')),
  severity text not null check (severity in ('minor','moderate','severe')),
  parts_cost numeric(10,2) not null,
  labor_hours numeric(5,1) not null,
  paint_materials_cost numeric(10,2) not null,
  primary key (part, action, severity)
);
grant select on public.repair_costs to anon, authenticated;
grant all on public.repair_costs to service_role;
alter table public.repair_costs enable row level security;
create policy "read costs" on public.repair_costs for select to anon, authenticated using (true);

with p(part, base_part, repair_labor, replace_labor, paint) as (values
 ('front bumper', 420, 2.0, 2.5, 180),
 ('rear bumper', 390, 2.0, 2.5, 170),
 ('hood', 610, 2.5, 1.8, 260),
 ('trunk/tailgate', 680, 2.5, 2.2, 240),
 ('roof', 950, 4.0, 12.0, 320),
 ('front left fender', 280, 2.0, 2.4, 190),
 ('front right fender', 280, 2.0, 2.4, 190),
 ('front left door', 720, 2.5, 3.2, 220),
 ('front right door', 720, 2.5, 3.2, 220),
 ('rear left door', 680, 2.5, 3.0, 210),
 ('rear right door', 680, 2.5, 3.0, 210),
 ('left quarter panel', 560, 3.5, 9.0, 240),
 ('right quarter panel', 560, 3.5, 9.0, 240),
 ('left headlight', 540, 0.8, 1.0, 0),
 ('right headlight', 540, 0.8, 1.0, 0),
 ('left taillight', 260, 0.5, 0.7, 0),
 ('right taillight', 260, 0.5, 0.7, 0),
 ('windshield', 450, 0.6, 2.5, 35),
 ('left side mirror', 310, 0.5, 0.8, 60),
 ('right side mirror', 310, 0.5, 0.8, 60),
 ('grille', 290, 0.6, 1.0, 0)
), s(severity, m, rm) as (values ('minor',1.0,1.0),('moderate',1.8,1.08),('severe',3.0,1.2))
insert into public.repair_costs
select part, 'repair', severity,
  round((base_part*0.04*m)::numeric, 2),
  round((repair_labor*m)::numeric, 1),
  round((paint*(0.6+0.4*m))::numeric, 2)
from p, s
union all
select part, 'replace', severity,
  round((base_part*rm)::numeric, 2),
  round((replace_labor*rm)::numeric, 1),
  round((paint*1.3)::numeric, 2)
from p, s;

create table public.claims (
  id text primary key,
  policy_number text not null,
  policyholder text not null,
  vehicle_year int not null,
  vehicle_make text not null,
  vehicle_model text not null,
  accident_date date not null,
  description text not null default '',
  photos jsonb not null default '[null,null,null,null]'::jsonb,
  status text not null default 'Ready for agent review' check (status in ('Ready for agent review','Awaiting customer photos','Submitted to senior','Returned to agent','Approved')),
  ai_result jsonb,
  ai_line_items jsonb not null default '[]'::jsonb,
  line_items jsonb not null default '[]'::jsonb,
  agent_notes text not null default '',
  rejection_reason text,
  photo_request_reason text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.claims to anon, authenticated;
grant all on public.claims to service_role;
alter table public.claims enable row level security;
create policy "internal read" on public.claims for select to anon, authenticated using (true);
create policy "internal insert" on public.claims for insert to anon, authenticated with check (true);
create policy "internal update" on public.claims for update to anon, authenticated using (true) with check (true);

create policy "claim photos read" on storage.objects for select to anon, authenticated using (bucket_id = 'claim-photos');
create policy "claim photos upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'claim-photos');

insert into public.claims (id, policy_number, policyholder, vehicle_year, vehicle_make, vehicle_model, accident_date, description, status, ai_result, ai_line_items, line_items, agent_notes, rejection_reason, created_at) values
('CLM-24-10421','PA-883120','Dana Whitfield',2021,'Toyota','Camry','2026-10-09','Backed into a low concrete post in a parking garage.','Ready for agent review',
 '{"photo_quality":[{"photo_index":0,"usable":true,"issue":null},{"photo_index":1,"usable":true,"issue":null}],"can_assess":true,"requires_inspection":false,"requires_inspection_reason":null}',
 '[{"id":"a1","photo_index":0,"part":"rear bumper","damage_type":"scratch","severity":"minor","action":"repair","confidence":0.94,"bbox":[520,300,700,640],"rationale":"Surface paint scratches across the lower rear bumper cover."},{"id":"a2","photo_index":1,"part":"rear bumper","damage_type":"dent","severity":"minor","action":"repair","confidence":0.89,"bbox":[430,420,600,580],"rationale":"Small shallow dent near the right corner, no cracking."}]',
 '[{"id":"a1","photo_index":0,"part":"rear bumper","damage_type":"scratch","severity":"minor","action":"repair","confidence":0.94,"bbox":[520,300,700,640],"rationale":"Surface paint scratches across the lower rear bumper cover."},{"id":"a2","photo_index":1,"part":"rear bumper","damage_type":"dent","severity":"minor","action":"repair","confidence":0.89,"bbox":[430,420,600,580],"rationale":"Small shallow dent near the right corner, no cracking."}]',
 '', null, now() - interval '5 hours'),
('CLM-24-10422','PA-551907','Marcus Oyelaran',2019,'Honda','Accord','2026-10-11','Sideswiped by a vehicle changing lanes on the highway.','Ready for agent review',
 '{"photo_quality":[{"photo_index":0,"usable":true,"issue":null},{"photo_index":1,"usable":true,"issue":null},{"photo_index":2,"usable":true,"issue":null}],"can_assess":true,"requires_inspection":false,"requires_inspection_reason":null}',
 '[{"id":"b1","photo_index":0,"part":"front left door","damage_type":"dent","severity":"moderate","action":"repair","confidence":0.86,"bbox":[380,260,640,720],"rationale":"Medium dent along the door body line with paint transfer."},{"id":"b2","photo_index":1,"part":"front left fender","damage_type":"crack","severity":"moderate","action":"replace","confidence":0.64,"bbox":[300,150,560,480],"rationale":"Possible crack at the fender edge; glare limits certainty."},{"id":"b3","photo_index":2,"part":"left side mirror","damage_type":"broken/shattered","severity":"severe","action":"replace","confidence":0.58,"bbox":[250,380,460,620],"rationale":"Mirror housing appears broken and glass missing."}]',
 '[{"id":"b1","photo_index":0,"part":"front left door","damage_type":"dent","severity":"moderate","action":"repair","confidence":0.86,"bbox":[380,260,640,720],"rationale":"Medium dent along the door body line with paint transfer."},{"id":"b2","photo_index":1,"part":"front left fender","damage_type":"crack","severity":"moderate","action":"replace","confidence":0.64,"bbox":[300,150,560,480],"rationale":"Possible crack at the fender edge; glare limits certainty."},{"id":"b3","photo_index":2,"part":"left side mirror","damage_type":"broken/shattered","severity":"severe","action":"replace","confidence":0.58,"bbox":[250,380,460,620],"rationale":"Mirror housing appears broken and glass missing."}]',
 '', null, now() - interval '4 hours'),
('CLM-24-10423','PA-207744','Priya Raman',2022,'Ford','F-150','2026-10-12','Front-end collision with a stopped vehicle at roughly 30 mph.','Ready for agent review',
 '{"photo_quality":[{"photo_index":0,"usable":true,"issue":null},{"photo_index":1,"usable":true,"issue":null},{"photo_index":2,"usable":true,"issue":null}],"can_assess":true,"requires_inspection":true,"requires_inspection_reason":"Structural deformation visible behind the grille; possible frame rail damage."}',
 '[{"id":"c1","photo_index":0,"part":"hood","damage_type":"structural deformation","severity":"severe","action":"replace","confidence":0.91,"bbox":[150,180,480,820],"rationale":"Hood buckled upward at the leading edge."},{"id":"c2","photo_index":0,"part":"grille","damage_type":"broken/shattered","severity":"severe","action":"replace","confidence":0.93,"bbox":[460,300,640,700],"rationale":"Grille shattered with missing sections."},{"id":"c3","photo_index":1,"part":"left headlight","damage_type":"broken/shattered","severity":"severe","action":"replace","confidence":0.88,"bbox":[380,120,560,380],"rationale":"Headlight lens and housing broken."},{"id":"c4","photo_index":2,"part":"front bumper","damage_type":"structural deformation","severity":"severe","action":"replace","confidence":0.82,"bbox":[560,100,860,900],"rationale":"Bumper pushed in with deformation of the reinforcement area."}]',
 '[{"id":"c1","photo_index":0,"part":"hood","damage_type":"structural deformation","severity":"severe","action":"replace","confidence":0.91,"bbox":[150,180,480,820],"rationale":"Hood buckled upward at the leading edge."},{"id":"c2","photo_index":0,"part":"grille","damage_type":"broken/shattered","severity":"severe","action":"replace","confidence":0.93,"bbox":[460,300,640,700],"rationale":"Grille shattered with missing sections."},{"id":"c3","photo_index":1,"part":"left headlight","damage_type":"broken/shattered","severity":"severe","action":"replace","confidence":0.88,"bbox":[380,120,560,380],"rationale":"Headlight lens and housing broken."},{"id":"c4","photo_index":2,"part":"front bumper","damage_type":"structural deformation","severity":"severe","action":"replace","confidence":0.82,"bbox":[560,100,860,900],"rationale":"Bumper pushed in with deformation of the reinforcement area."}]',
 '', null, now() - interval '3 hours'),
('CLM-24-10424','PA-664018','Jonah Feldman',2018,'Subaru','Outback','2026-10-13','Struck a shopping cart corral at night.','Ready for agent review',
 '{"photo_quality":[{"photo_index":0,"usable":true,"issue":null},{"photo_index":1,"usable":false,"issue":"blurry"},{"photo_index":2,"usable":false,"issue":"too dark"}],"can_assess":true,"requires_inspection":false,"requires_inspection_reason":null}',
 '[{"id":"d1","photo_index":0,"part":"front right fender","damage_type":"dent","severity":"moderate","action":"repair","confidence":0.77,"bbox":[340,420,600,820],"rationale":"Dent visible on the fender above the wheel arch."}]',
 '[{"id":"d1","photo_index":0,"part":"front right fender","damage_type":"dent","severity":"moderate","action":"repair","confidence":0.77,"bbox":[340,420,600,820],"rationale":"Dent visible on the fender above the wheel arch."}]',
 '', null, now() - interval '2 hours'),
('CLM-24-10425','PA-339562','Elena Castellanos',2020,'Mazda','CX-5','2026-10-14','Policyholder reports rear door scrape from a bicycle.','Ready for agent review',
 '{"photo_quality":[{"photo_index":0,"usable":false,"issue":"no damage visible"},{"photo_index":1,"usable":false,"issue":"vehicle not visible"}],"can_assess":false,"requires_inspection":false,"requires_inspection_reason":null}',
 '[]','[]','', null, now() - interval '1 hour'),
('CLM-24-10426','PA-120389','Theo Brandt',2023,'Hyundai','Elantra','2026-10-07','Low-speed bump into another car while parking.','Returned to agent',
 '{"photo_quality":[{"photo_index":0,"usable":true,"issue":null},{"photo_index":1,"usable":true,"issue":null}],"can_assess":true,"requires_inspection":false,"requires_inspection_reason":null}',
 '[{"id":"f1","photo_index":0,"part":"front bumper","damage_type":"scratch","severity":"minor","action":"repair","confidence":0.9,"bbox":[540,200,760,800],"rationale":"Scuffs and light scratches on the bumper cover."},{"id":"f2","photo_index":1,"part":"right headlight","damage_type":"crack","severity":"minor","action":"replace","confidence":0.73,"bbox":[360,560,520,820],"rationale":"Hairline crack in the headlight lens."}]',
 '[{"id":"f1","photo_index":0,"part":"front bumper","damage_type":"scratch","severity":"minor","action":"replace","confidence":0.9,"bbox":[540,200,760,800],"rationale":"Scuffs and light scratches on the bumper cover."},{"id":"f2","photo_index":1,"part":"right headlight","damage_type":"crack","severity":"minor","action":"replace","confidence":0.73,"bbox":[360,560,520,820],"rationale":"Hairline crack in the headlight lens.","price_override":420,"override_reason":"OEM lens quote from dealer is $420 installed."}]',
 'Customer prefers OEM parts. Changed bumper to replace due to paint mismatch risk.',
 'Front bumper should be repair, not replace – damage is minor.', now() - interval '1 day');