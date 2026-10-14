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
