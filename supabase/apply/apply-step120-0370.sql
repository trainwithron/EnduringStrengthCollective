-- STEP 120: 0370 The Needs attention list can be quieted: Not now (a week) and No macros for a client
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the code that goes with it is live. Then every item on Needs attention has Not now (hidden for a week, back only if still true), the macros item also has No macros for [name], and the client's Nutrition tab shows Macros are off for [name] with Turn on. Run it BEFORE the code.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.attention_snoozes') is null)) then
    raise exception 'Step 120 (0370) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
