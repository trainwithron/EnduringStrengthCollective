-- RELEASE BH (A ONE-TIME REVIEW REQUEST, A REVIEW LINK AND CLIENT QUOTES; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 102 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 102: Nothing visible until an adult client reaches 12 sessions. They see one small card, once. A review they send is private to the coach unless they ticked that the coach may share it; only a ticked one can go on the coach's page, and only when the coach adds it.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BH (a one-time review request, a review link and client quotes; run BEFORE the code that goes with it is live), step 102: 0356 Asking a happy client for a review, once and quietly: a one-time card after 12 sessions with a box for a short review and a tick to agree the coach may share it publicly, and quotes the coach approves
do $g102$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0356 is not already applied (no quotes table yet)', to_regclass('public.client_quotes') is null),
      ('the coach website table exists', to_regclass('public.coach_sites') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BH (a one-time review request, a review link and client quotes; run BEFORE the code that goes with it is live), step 102 (0356) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g102$;

-- ====================================================================================================
-- migration 0356_review_prompt_and_client_quotes.sql
-- ====================================================================================================

-- Release BH: asking a happy client for a review, once and quietly. A client who has done 12 sessions (and is an adult) is shown ONE small card (never again, whatever they answer) with a box for a short
-- review and a box to tick if they agree the coach may share it publicly. A review without that tick stays private to the coach; a ticked one can be featured on the coach's page, but only when the coach
-- chooses to add it: nothing is published by the client.

create table if not exists public.client_quotes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 240),
  first_name text check (first_name is null or char_length(first_name) <= 30),
  -- the client's own tick: "I agree the coach may share this publicly". Without it the quote is never shown anywhere but to the coach.
  share_publicly boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'used', 'declined')),
  created_at timestamptz not null default now()
);
create index if not exists client_quotes_coach_idx on public.client_quotes (coach_id, status);
alter table public.client_quotes enable row level security;
revoke all on public.client_quotes from anon;
-- The client writes and sees only their own quote, and only to a coach of their own group; the coaches of that group read it and say what happens to it. A client cannot change a quote after sending it.
create policy "client_quotes_insert_own" on public.client_quotes for insert to authenticated
  with check (
    athlete_id = (select auth.uid()) and status = 'pending'
    and exists (select 1 from public.group_memberships a where a.group_id = client_quotes.group_id and a.profile_id = (select auth.uid()) and a.role = 'athlete')
    and exists (select 1 from public.group_memberships c where c.group_id = client_quotes.group_id and c.profile_id = client_quotes.coach_id and c.role = 'coach')
  );
create policy "client_quotes_select_own_or_coach" on public.client_quotes for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "client_quotes_update_coach" on public.client_quotes for update to authenticated
  using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
-- A coach says what happens to a quote (status) and can change nothing else: they cannot edit what a client wrote.
revoke update on public.client_quotes from authenticated;
grant update (status) on public.client_quotes to authenticated;

-- One row per client and group once the card has been shown, so it never comes back.
create table if not exists public.review_prompts_shown (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  shown_at timestamptz not null default now(),
  outcome text check (outcome is null or outcome in ('quote', 'not_now')),
  primary key (athlete_id, group_id)
);
alter table public.review_prompts_shown enable row level security;
revoke all on public.review_prompts_shown from anon;
create policy "review_prompts_shown_own" on public.review_prompts_shown for all to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()) and exists (select 1 from public.group_memberships a where a.group_id = review_prompts_shown.group_id and a.profile_id = (select auth.uid()) and a.role = 'athlete'));

-- Both tables carry the organization-wall rule (Release AZ) when that is installed.
do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null then
    create policy "org_wall_header" on public.client_quotes as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
    create policy "org_wall_header" on public.review_prompts_shown as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 102 (0356)' as step, '0356 Asking a happy client for a review' as what, not ((to_regclass('public.client_quotes') is null)) as in_place
) as result order by step;
