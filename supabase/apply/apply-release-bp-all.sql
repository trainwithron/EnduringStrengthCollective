-- RELEASE BP (THE SHARED EXERCISE CATALOG, EMPTY; RUN ANY TIME): ONE paste. Steps 110 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 110: Nothing changes on screen. Two new empty tables (the catalog and its spellings) and one new empty column on the exercise library.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BP (the shared exercise catalog, empty; run any time), step 110: 0361 The shared exercise catalog (empty): one list of real movements everyone can read and only the platform admin can write, and a link from each coach's library entry to its movement
do $g110$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0361 is not already applied (the catalog table does not exist yet)', to_regclass('public.exercise_catalog') is null),
      ('the platform-admin helper and the exercise library exist', to_regprocedure('public.is_platform_admin()') is not null and to_regclass('public.exercise_library') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BP (the shared exercise catalog, empty; run any time), step 110 (0361) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g110$;

-- ====================================================================================================
-- migration 0361_exercise_catalog.sql
-- ====================================================================================================

-- Release BP (schema, nothing visible changes): the shared exercise catalog. One platform-wide list of real movements (name, category, equipment), and the other ways each one is written
-- (an alias per spelling). Everyone signed in can read it; only the platform admin can write it. It holds exercise NAMES ONLY: no coach's video, notes, clients or programs. A coach's own
-- exercise_library row stays the coach's own layer on top (their display name, their video) and gains catalog_id, which says which real movement it is. The old per-coach exercise_aliases
-- (what a coach typed -> which of their library exercises) is unchanged.
create table public.exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text,
  equipment text,
  batch text,
  created_at timestamptz not null default now()
);
create unique index exercise_catalog_name_key on public.exercise_catalog (lower(name));

create table public.exercise_catalog_aliases (
  alias_key text primary key check (alias_key = lower(alias_key) and alias_key ~ '^[a-z0-9]+$'),
  catalog_id uuid not null references public.exercise_catalog(id) on delete cascade,
  alias text not null check (char_length(btrim(alias)) between 1 and 120),
  batch text,
  created_at timestamptz not null default now()
);
create index exercise_catalog_aliases_catalog_idx on public.exercise_catalog_aliases (catalog_id);

alter table public.exercise_library add column catalog_id uuid references public.exercise_catalog(id) on delete set null;
create index exercise_library_catalog_idx on public.exercise_library (catalog_id) where catalog_id is not null;

alter table public.exercise_catalog enable row level security;
alter table public.exercise_catalog_aliases enable row level security;
revoke all on public.exercise_catalog from anon;
revoke all on public.exercise_catalog_aliases from anon;

create policy "exercise_catalog_read" on public.exercise_catalog for select to authenticated using (true);
create policy "exercise_catalog_admin_write" on public.exercise_catalog for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "exercise_catalog_aliases_read" on public.exercise_catalog_aliases for select to authenticated using (true);
create policy "exercise_catalog_aliases_admin_write" on public.exercise_catalog_aliases for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 110 (0361)' as step, '0361 The shared exercise catalog' as what, not ((to_regclass('public.exercise_catalog') is null)) as in_place
) as result order by step;
