-- RELEASE S1 (A CHANGED SIGN-IN EMAIL IS CONFIRMED BY THE NEW ADDRESS; ADDS ONLY, SAFE TO RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 150 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 150: Nothing changes on screen until the Release S1 code is live. Adds one empty table for sign-in email changes waiting for confirmation (nobody can read it from the app) and two new kinds of notice. Safe to run before the code is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release S1 (a changed sign-in email is confirmed by the new address; adds only, safe to run BEFORE the code that goes with it is live), step 150: 0398 Release S1: a changed sign-in email must be confirmed by the new address first (waiting requests table)
do $g150$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0398 is not already applied (the waiting-requests table is not there yet)', to_regclass('public.pending_email_changes') is null),
      ('the tables it builds on exist', to_regclass('public.profiles') is not null and to_regclass('public.groups') is not null and to_regclass('public.notifications') is not null),
      ('the notification type rule exists to be widened', exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release S1 (a changed sign-in email is confirmed by the new address; adds only, safe to run BEFORE the code that goes with it is live), step 150 (0398) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g150$;

-- ====================================================================================================
-- migration 0398_pending_email_changes.sql
-- ====================================================================================================

-- 0398: a coach changing the sign-in email of a client who has already signed in no longer changes it on the spot. The new address is asked to confirm by an emailed link first (and the old address is told), and
-- only then does it become the login. This table holds the waiting requests: each link carries its own random token (confirm for the new address, cancel for the old), only their hashes are stored, a request can be confirmed from a day after it was asked for (when the account has signed in and has a real old email) and then stays open 48 hours, and a newer request for the same person
-- replaces an older one. Nobody reads or writes it from the app: only the server (service key) touches it.

create table if not exists public.pending_email_changes (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  new_email text not null,
  old_email text,
  -- Two different random tokens: the confirm link goes ONLY to the new address, the cancel link ONLY to the old one, so neither mail can do the other's job.
  token_hash text not null unique,
  cancel_token_hash text not null unique,
  requested_by uuid references public.profiles(id) on delete set null,
  group_id uuid references public.groups(id) on delete set null,
  -- The earliest the new address can confirm (a day after the request when the account has signed in and has a real old email, so the old address and the in-app banner always get time to be seen).
  confirmable_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pending_email_changes_profile_idx on public.pending_email_changes (profile_id, created_at desc);
alter table public.pending_email_changes enable row level security;
revoke all on public.pending_email_changes from anon, authenticated;

-- Two new kinds of notice to the client: a change was asked for (nothing has changed yet), and it was cancelled.
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['email_change_requested', 'email_change_cancelled']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 150 (0398)' as step, '0398 Release S1: a changed sign-in email must be confirmed by the new address first' as what, not ((to_regclass('public.pending_email_changes') is null)) as in_place
) as result order by step;
