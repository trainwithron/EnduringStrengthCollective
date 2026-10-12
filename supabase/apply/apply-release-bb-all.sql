-- RELEASE BB (PRO SHOP LINKS, REFERRAL PARTNERS, CHALLENGES, CALENDAR ENTRIES, SESSION TYPES AND DISCOVERY PROSPECTS PER ORGANIZATION; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 96 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 96: Nothing is deleted. Each existing row is given the coach's usual organization (the only one, or the one with the most clients; a challenge takes its program's). From the code that goes with it, a coach who runs two organizations sees a separate shop, partner list, challenges, calendar entries and session types in each, and a client sees only their own organization's. Run it BEFORE the code that goes with it is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BB (Pro Shop links, referral partners, challenges, calendar entries, session types and discovery prospects per organization; run BEFORE the code that goes with it is live), step 96: 0350 A coach's Pro Shop links, referral partners, challenges, calendar entries, session types and discovery-call prospects belong to an organization, and a client sees only the organization they are a client in
do $g96$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0350 is not already applied (the shop links have no organization column yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pro_shop_links' and column_name = 'organization_id')),
      ('the six tables exist', to_regclass('public.pro_shop_links') is not null and to_regclass('public.referral_partners') is not null and to_regclass('public.challenges') is not null and to_regclass('public.calendar_events') is not null and to_regclass('public.session_types') is not null and to_regclass('public.discovery_bookings') is not null),
      ('the helper is_client_of_coach exists', exists (select 1 from pg_proc where proname = 'is_client_of_coach' and pronamespace = 'public'::regnamespace))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BB (Pro Shop links, referral partners, challenges, calendar entries, session types and discovery prospects per organization; run BEFORE the code that goes with it is live), step 96 (0350) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g96$;

-- ====================================================================================================
-- migration 0350_coach_tables_per_organization.sql
-- ====================================================================================================

-- Release BB: the coach's own business lists are kept PER ORGANIZATION, like everything else behind the organization walls. Pro Shop links, referral partners, challenges, calendar events, session types and
-- discovery-call prospects each get an organization. Until now they belonged to the coach alone, so a coach who runs two organizations saw (and a client of either organization saw) the same shop, partners, challenges
-- and calendar entries in both. Existing rows are given the coach's usual organization (the only one, or the one with the most clients; a challenge takes its program's). New rows are filed in the organization the
-- coach is working in (the app sends it; a row saved without one gets the coach's usual organization). A client sees a coach's shop, partners and challenges only for the organization they are a client in.
-- Nothing is deleted. The coach booking page (one public page per coach) is NOT changed here.
create or replace function public.default_org_for_coach(p_coach uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id
  from public.organization_memberships m
  where m.profile_id = p_coach
  order by (select count(*) from public.group_memberships gm join public.groups g on g.id = gm.group_id
            where g.organization_id = m.organization_id and gm.role = 'athlete') desc, m.organization_id
  limit 1
$$;

-- True when the signed-in person coaches (or administers) the organization, or the row has no organization yet.
create or replace function public.coach_in_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is null or exists (select 1 from public.organization_memberships om where om.organization_id = p_org and om.profile_id = auth.uid())
$$;

-- True when the signed-in person is a client of the coach in a group of that organization (an unfiled row falls back to "client of the coach").
create or replace function public.client_of_coach_in_org(p_coach uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_org is null then public.is_client_of_coach(p_coach)
    else exists (
      select 1 from public.group_memberships gm_coach
      join public.group_memberships gm_athlete on gm_athlete.group_id = gm_coach.group_id
      join public.groups g on g.id = gm_coach.group_id
      where gm_coach.profile_id = p_coach and gm_coach.role = 'coach'
        and gm_athlete.profile_id = auth.uid() and gm_athlete.role = 'athlete'
        and g.organization_id = p_org)
  end
$$;

create or replace function public.fill_coach_row_organization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is null then
    new.organization_id := public.default_org_for_coach(new.coach_id);
  end if;
  return new;
end
$$;
revoke execute on function public.fill_coach_row_organization() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['pro_shop_links','referral_partners','challenges','calendar_events','session_types','discovery_bookings'] loop
    execute format('alter table public.%I add column if not exists organization_id uuid references public.organizations(id) on delete cascade', t);
    execute format('create index if not exists %I on public.%I (organization_id)', t || '_organization_id_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_fill_organization', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.fill_coach_row_organization()', t || '_fill_organization', t);
  end loop;
end
$$;

-- Existing rows: a challenge takes its program's organization; everything else the coach's usual one.
update public.challenges c set organization_id = g.organization_id
  from public.programs p join public.groups g on g.id = p.group_id
  where c.program_id = p.id and c.organization_id is null;
update public.pro_shop_links set organization_id = public.default_org_for_coach(coach_id) where organization_id is null;
update public.referral_partners set organization_id = public.default_org_for_coach(coach_id) where organization_id is null;
update public.challenges set organization_id = public.default_org_for_coach(coach_id) where organization_id is null;
update public.calendar_events set organization_id = public.default_org_for_coach(coach_id) where organization_id is null;
update public.session_types set organization_id = public.default_org_for_coach(coach_id) where organization_id is null;
update public.discovery_bookings set organization_id = public.default_org_for_coach(coach_id) where organization_id is null;

-- Rules. The coach's own rows: only for an organization they belong to. A client: only the organization they are a client in.
drop policy if exists "pro_shop_links_select_own_or_client" on public.pro_shop_links;
create policy "pro_shop_links_select_own_or_client" on public.pro_shop_links for select to authenticated
  using ((coach_id = (select auth.uid()) and public.coach_in_org(organization_id)) or public.client_of_coach_in_org(coach_id, organization_id));
drop policy if exists "pro_shop_links_insert_coach" on public.pro_shop_links;
create policy "pro_shop_links_insert_coach" on public.pro_shop_links for insert to authenticated
  with check (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));
drop policy if exists "pro_shop_links_update_coach" on public.pro_shop_links;
create policy "pro_shop_links_update_coach" on public.pro_shop_links for update to authenticated
  using (coach_id = (select auth.uid()) and public.coach_in_org(organization_id)) with check (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));
drop policy if exists "pro_shop_links_delete_coach" on public.pro_shop_links;
create policy "pro_shop_links_delete_coach" on public.pro_shop_links for delete to authenticated
  using (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));

drop policy if exists "referral_partners_select_own_or_client" on public.referral_partners;
create policy "referral_partners_select_own_or_client" on public.referral_partners for select to authenticated
  using ((coach_id = (select auth.uid()) and public.coach_in_org(organization_id)) or public.client_of_coach_in_org(coach_id, organization_id));
drop policy if exists "referral_partners_insert_coach" on public.referral_partners;
create policy "referral_partners_insert_coach" on public.referral_partners for insert to authenticated
  with check (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));
drop policy if exists "referral_partners_update_coach" on public.referral_partners;
create policy "referral_partners_update_coach" on public.referral_partners for update to authenticated
  using (coach_id = (select auth.uid()) and public.coach_in_org(organization_id)) with check (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));
drop policy if exists "referral_partners_delete_coach" on public.referral_partners;
create policy "referral_partners_delete_coach" on public.referral_partners for delete to authenticated
  using (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));

drop policy if exists "challenges_select_own_or_client" on public.challenges;
create policy "challenges_select_own_or_client" on public.challenges for select to authenticated
  using ((coach_id = (select auth.uid()) and public.coach_in_org(organization_id)) or (status <> 'draft'::challenge_status and public.client_of_coach_in_org(coach_id, organization_id)));
drop policy if exists "challenges_insert_coach" on public.challenges;
create policy "challenges_insert_coach" on public.challenges for insert to authenticated
  with check (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));
drop policy if exists "challenges_update_coach" on public.challenges;
create policy "challenges_update_coach" on public.challenges for update to authenticated
  using (coach_id = (select auth.uid()) and public.coach_in_org(organization_id)) with check (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));
drop policy if exists "challenges_delete_coach" on public.challenges;
create policy "challenges_delete_coach" on public.challenges for delete to authenticated
  using (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));

drop policy if exists "calendar_events_owner" on public.calendar_events;
create policy "calendar_events_owner" on public.calendar_events for all to authenticated
  using (coach_id = (select auth.uid()) and public.coach_in_org(organization_id)) with check (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));
drop policy if exists "session_types_coach_manage" on public.session_types;
create policy "session_types_coach_manage" on public.session_types for all to authenticated
  using (coach_id = (select auth.uid()) and public.coach_in_org(organization_id)) with check (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));
drop policy if exists "discovery_bookings_coach_manage" on public.discovery_bookings;
create policy "discovery_bookings_coach_manage" on public.discovery_bookings for all to authenticated
  using (coach_id = (select auth.uid()) and public.coach_in_org(organization_id)) with check (coach_id = (select auth.uid()) and public.coach_in_org(organization_id));

revoke execute on function public.default_org_for_coach(uuid) from public, anon;
revoke execute on function public.coach_in_org(uuid) from public, anon;
revoke execute on function public.client_of_coach_in_org(uuid, uuid) from public, anon;
grant execute on function public.default_org_for_coach(uuid) to authenticated, service_role;
grant execute on function public.coach_in_org(uuid) to authenticated, service_role;
grant execute on function public.client_of_coach_in_org(uuid, uuid) to authenticated, service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 96 (0350)' as step, '0350 A coach''s Pro Shop links' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pro_shop_links' and column_name = 'organization_id'))) as in_place
) as result order by step;
