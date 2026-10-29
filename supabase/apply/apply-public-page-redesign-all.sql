-- PUBLIC COACH PAGE REDESIGN (NEW OPTIONAL PAGE TEXT + RON'S WORDING): ONE paste. Step 192, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once.
-- If any check is false, the run stops with a message naming the failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: "Success", then a result table with one row per check and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Commander. Do not run it again.
-- AFTER STEP 192: the new page design goes live with the app update (deployed right after).
-- UNDO: supabase/apply/undo-step192-0439.sql

begin;

do $g192$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0439 is not already applied (coach_sites has no tagline yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_sites' and column_name = 'tagline')),
      ('coach_sites still limits Why pick me to 3 lines', exists (select 1 from pg_constraint where conname = 'coach_sites_why_lines_check' and conrelid = 'public.coach_sites'::regclass and pg_get_constraintdef(oid) = 'CHECK ((cardinality(why_lines) <= 3))')),
      ('Ron''s page row exists and is still empty (nothing he typed gets replaced)', exists (select 1 from public.coach_sites where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and headline is null and who_i_help is null and what_i_do is null and cardinality(why_lines) = 0))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Public page redesign, step 192 (0439) cannot run. Failed checks: %. NOTHING was changed. Send Commander this message.', failed;
  end if;
end
$g192$;

-- ===== migration 0439_public_page_redesign.sql =====

alter table public.coach_sites add column if not exists eyebrow text;
alter table public.coach_sites add column if not exists facts jsonb not null default '[]'::jsonb;
alter table public.coach_sites add column if not exists packages_note text;
alter table public.coach_sites add column if not exists tagline text;
alter table public.coach_sites add column if not exists consult_note text;

do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'coach_sites_eyebrow_check' and conrelid = 'public.coach_sites'::regclass) then
    alter table public.coach_sites add constraint coach_sites_eyebrow_check check (eyebrow is null or char_length(eyebrow) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coach_sites_facts_check' and conrelid = 'public.coach_sites'::regclass) then
    alter table public.coach_sites add constraint coach_sites_facts_check check (jsonb_typeof(facts) = 'array' and jsonb_array_length(facts) <= 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coach_sites_packages_note_check' and conrelid = 'public.coach_sites'::regclass) then
    alter table public.coach_sites add constraint coach_sites_packages_note_check check (packages_note is null or char_length(packages_note) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coach_sites_tagline_check' and conrelid = 'public.coach_sites'::regclass) then
    alter table public.coach_sites add constraint coach_sites_tagline_check check (tagline is null or char_length(tagline) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coach_sites_consult_note_check' and conrelid = 'public.coach_sites'::regclass) then
    alter table public.coach_sites add constraint coach_sites_consult_note_check check (consult_note is null or char_length(consult_note) <= 200);
  end if;
end
$checks$;

alter table public.coach_sites drop constraint if exists coach_sites_why_lines_check;
alter table public.coach_sites add constraint coach_sites_why_lines_check check (cardinality(why_lines) <= 6);

-- ===== Ron's own page wording (approved mockup, Oct 28). Only his row, only while it is empty (checked above). Packages and reviews untouched. =====
update public.coach_sites set
  headline = 'Strength that lasts, coaching that shows up.',
  eyebrow = 'Strength coach · In person and online',
  facts = '[{"title":"Free consult","line":"Up to 50 min in person, 30 online"},{"title":"Tailored to you","line":"Proven templates, adjusted for each person"},{"title":"Anywhere","line":"Train in person or from any city"}]'::jsonb,
  who_i_help = 'Busy adults, athletes and military families who want to get strong, move well and keep it going, wherever life moves them.',
  what_i_do = 'I build your program from proven templates around your goals, your schedule and the equipment you actually have. Then I coach you through it every week in the app and change it as you get stronger.',
  why_lines = array[
    'Proven templates, tailored to you with easier and harder options',
    'A free consult before you commit: up to 50 minutes in person, 30 online',
    'Every workout, check-in and message in one app',
    'Coaching that moves with you, in any city',
    'Strength, mobility and nutrition in one plan',
    'Faith-based and people-first'
  ],
  packages_note = 'In person is $100 a session, whatever the package size. Five sessions a week is $500 a week, about $2,000 a month.',
  tagline = 'Building Strength and Faith that Endures',
  consult_note = 'Your first consultation is free: up to 50 minutes in person, or up to 30 minutes online.',
  updated_at = now()
where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8';

commit;

select check_name, in_place from (values
  ('new page text columns', (select count(*) = 5 from information_schema.columns where table_schema = 'public' and table_name = 'coach_sites' and column_name in ('eyebrow','facts','packages_note','tagline','consult_note'))),
  ('Why pick me allows 6 lines', exists (select 1 from pg_constraint where conname = 'coach_sites_why_lines_check' and pg_get_constraintdef(oid) = 'CHECK ((cardinality(why_lines) <= 6))')),
  ('Ron''s page wording in', exists (select 1 from public.coach_sites where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and tagline = 'Building Strength and Faith that Endures' and cardinality(why_lines) = 6))
) as v(check_name, in_place);
