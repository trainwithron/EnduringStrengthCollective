-- RELEASE BZ (NEEDS ATTENTION: NOT NOW FOR A WEEK, AND NO MACROS FOR A CLIENT; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 120 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 120: Nothing changes on screen until the code that goes with it is live. Then every item on Needs attention has Not now (hidden for a week, back only if still true), the macros item also has No macros for [name], and the client's Nutrition tab shows Macros are off for [name] with Turn on. Run it BEFORE the code.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BZ (Needs attention: Not now for a week, and No macros for a client; run BEFORE the code that goes with it is live), step 120: 0370 The Needs attention list can be quieted: Not now (a week) and No macros for a client
do $g120$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0370 is not already applied (no snooze table yet)', to_regclass('public.attention_snoozes') is null),
      ('the memberships table exists', to_regclass('public.group_memberships') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BZ (Needs attention: Not now for a week, and No macros for a client; run BEFORE the code that goes with it is live), step 120 (0370) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g120$;

-- ====================================================================================================
-- migration 0370_attention_snooze_and_macros_off.sql
-- ====================================================================================================

-- Release BZ: the Needs attention list can be quieted. Two small things, both private to the coach:
--
--   * attention_snoozes: "Not now" on an item hides it for that client for a week (until_date); it comes back only if it is still true after. One row per coach, client and kind of item.
--   * group_memberships.coach_sets_macros: "No macros for Sawyer". This coach does not set macros for this client, so the "no macros set for next week" nudge stops for good; one tap turns it back on from the
--     client's Nutrition tab. It is not the same as food_tracking_enabled (whether the CLIENT can log food). Nullable on purpose: empty counts as on, so a backup restore that does not know the column
--     breaks nothing. Written by the coach the same way as the other per-client switches on a membership.
-- Nothing else changes. Re-runnable.

alter table public.group_memberships add column if not exists coach_sets_macros boolean;

create table if not exists public.attention_snoozes (
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  trigger_key text not null check (trigger_key in ('program_ending', 'macros_missing')),
  until_date date not null,
  primary key (coach_id, athlete_id, trigger_key)
);
alter table public.attention_snoozes enable row level security;
revoke all on public.attention_snoozes from anon;
drop policy if exists "attention_snoozes_own_coach" on public.attention_snoozes;
create policy "attention_snoozes_own_coach" on public.attention_snoozes for all to authenticated
  using (coach_id = (select auth.uid()) and public.is_group_coach(group_id))
  with check (coach_id = (select auth.uid()) and public.is_group_coach(group_id));

do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attention_snoozes' and policyname = 'org_wall_header') then
    create policy "org_wall_header" on public.attention_snoozes as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 120 (0370)' as step, '0370 The Needs attention list can be quieted: Not now' as what, not ((to_regclass('public.attention_snoozes') is null)) as in_place
) as result order by step;
