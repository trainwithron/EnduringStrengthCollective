-- RELEASE Y (A COACH'S PUBLIC WEBSITE AND FEATURED SHOP CARDS): ONE paste. Steps 67 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 67: Business now has My website, where a coach fills in a few short fields and switches Publish on. Pro Shop cards can be marked Featured. Nothing is public until a coach publishes, and nothing changes for anyone until then.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release Y (a coach's public website and featured shop cards), step 67: 0321 A coach's one short public website (My website): a private table for what the coach types, and a featured flag on Pro Shop cards (nothing is public until the coach publishes)
do $g67$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0321 is not already applied (there is no coach_sites table yet)', to_regclass('public.coach_sites') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release Y (a coach''s public website and featured shop cards), step 67 (0321) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g67$;

-- ====================================================================================================
-- migration 0321_coach_site.sql
-- ====================================================================================================

-- Release Y: a coach's one short public page ("My website", shown at /c/<their booking address>) and featured Pro Shop cards.
--   * coach_sites: one row per coach with what the coach typed (a headline, a short About with two small prompts, up to 3 "why pick me" lines, up to 3 short reviews typed by the coach with
--     a first name, a hero photo and a cover photo path) and a background choice. It is private: only the coach can read or write their own row. The public page reads PUBLISHED rows only,
--     through the server, so unpublished text is never exposed. Nothing is public until the coach switches Publish on (it starts off).
--   * pro_shop_links.featured: the coach marks 2-3 Pro Shop cards to show on that page (and first in the client's Pro Shop). Default off, so nothing changes until they choose.
-- No data is touched. Re-runnable.

create table if not exists public.coach_sites (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  headline text check (headline is null or char_length(headline) <= 120),
  who_i_help text check (who_i_help is null or char_length(who_i_help) <= 300),
  what_i_do text check (what_i_do is null or char_length(what_i_do) <= 600),
  why_lines text[] not null default '{}' check (cardinality(why_lines) <= 3),
  reviews jsonb not null default '[]'::jsonb check (jsonb_typeof(reviews) = 'array' and jsonb_array_length(reviews) <= 3),
  hero_path text,
  cover_path text,
  background text not null default 'dark' check (background in ('dark', 'light', 'brand')),
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.coach_sites enable row level security;

drop policy if exists coach_sites_own on public.coach_sites;
create policy coach_sites_own on public.coach_sites for all to authenticated
  using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));

alter table public.pro_shop_links add column if not exists featured boolean not null default false;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 67 (0321)' as step, '0321 A coach''s one short public website' as what, not ((to_regclass('public.coach_sites') is null)) as in_place
) as result order by step;
