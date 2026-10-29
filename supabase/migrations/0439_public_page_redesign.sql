-- The public coach page redesign (Ron, Oct 28, approved mockup: "this works for now"): five optional text pieces on a coach's page, each shown only when filled in, all typed by the
-- coach in Business > My website: a short line above the name (eyebrow), up to three facts under the header ({title, line}), a note under the packages, a closing line (tagline) and a
-- line about the consultation. Why pick me holds up to six lines (was three). Nothing about clients. Same row rules as the rest of coach_sites. Re-runnable.

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
