-- RELEASE TC3 (ONE INVITATION LINK PER INVITED PERSON: ONE NEW TABLE): ONE paste. Steps 173 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 173: Nothing changes on screen until the Release TC3 code is live. Run this BEFORE that code (the invitation screens and the join page read the table).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release TC3 (one invitation link per invited person: one new table), step 173: 0421 Release TC3: one invitation link per invited person (one new table, only the server reads it; no link or secret is stored in it)
do $g173$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0421 is not already applied (the links table is not there yet)', to_regclass('public.coach_join_links') is null),
      ('the tables it points at exist', to_regclass('public.organizations') is not null and to_regclass('public.profiles') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release TC3 (one invitation link per invited person: one new table), step 173 (0421) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g173$;

-- ====================================================================================================
-- migration 0421_coach_join_links.sql
-- ====================================================================================================

-- Release TC3: ONE invitation link per invited person. Until now an invitation was a one-time link made by the auth service: an email scanner or a message preview "opened" it and used it up (Kade Thompson's link was used
-- 13 seconds after it was made, by nobody), and sending the email again or copying the link made a NEW link and cancelled the old one.
--
-- coach_join_links holds one row per invited person and organization: the link is /join-coach/<id>.<signature>, where the signature is made by the server from the id and a server secret, so NO link or secret is stored here:
-- a copy of this table alone gives nobody a working link. The same link is in the email and the one an administrator copies for a text message; sending the email again keeps it and only moves its end date out (14 days);
-- it stops working when it is used (a password chosen on the join page: opening the link changes nothing), cancelled or expired. A person who has signed in already gets a link of kind 'signin' that is only ever emailed to
-- their own address, never shown to the administrator. Only the server touches the table (row security on, no policy for anyone). Adds one table and two indexes. Re-runnable.
create table if not exists public.coach_join_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'invite' check (kind in ('invite', 'signin')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
-- at most ONE open link per person and organization (a second one cannot be made while one is open; the first is extended instead)
create unique index if not exists coach_join_links_one_open on public.coach_join_links (profile_id, organization_id) where used_at is null and revoked_at is null;
create index if not exists coach_join_links_org_idx on public.coach_join_links (organization_id);
alter table public.coach_join_links enable row level security;
revoke all on public.coach_join_links from anon, authenticated;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 173 (0421)' as step, '0421 Release TC3: one invitation link per invited person' as what, not ((to_regclass('public.coach_join_links') is null)) as in_place
) as result order by step;
