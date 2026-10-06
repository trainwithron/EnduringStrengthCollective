-- STEP 02: 0244 macro target history and row security, 0255 legal acceptances and locked waiver, 0256 marketplace listing opt-in, 0257 feedback reports, 0258 help-search log
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Standing macro targets are kept as dated history (existing targets are carried over). A client can no longer rewrite a completed waiver. Public coach listing is off for every organization until its owner switches it on. The Report a problem list and the Ask Spot unanswered-question log start recording.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.client_macro_target_history') is null)
     and (to_regclass('public.legal_acceptances') is null)
     and (to_regclass('public.feedback_reports') is null and to_regclass('public.nav_query_log') is null)) then
    raise exception 'Step 02 (0244-0255-0256-0257-0258) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0244_macro_target_history_and_rls.sql
-- ====================================================================================================

-- Standing macro targets become a dated history, and the write policy stops trusting any coach.
--
-- Two problems with 0239's client_macro_targets:
--   1. Its policy was is_group_coach(group_id) alone and its primary key was athlete_id alone. Any coach could
--      insert a row for any athlete's id (naming a group they coach), and the real coach's later upsert for that
--      athlete then collided with it and was refused.
--   2. One row per athlete meant editing protein on Wednesday rewrote Monday and Tuesday on the calendar and
--      in trends, because every day without its own row read the single current target.
--
-- Fix: a history table keyed (athlete_id, group_id, effective_from). A day shows the newest row whose
-- effective_from is on or before it. A row with every number null means "no standing target from this date".
-- Writes require the athlete to be a member of the group as well as the caller coaching it.
--
-- Safe to apply before the matching code is deployed: deployed code reads and writes client_macro_targets,
-- which keeps working (its policy is tightened, not removed), and new code falls back to that table until this
-- one exists.

create table if not exists public.client_macro_target_history (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  effective_from date not null,
  calories int check (calories is null or calories between 0 and 20000),
  protein_g int check (protein_g is null or protein_g between 0 and 1500),
  carbs_g int check (carbs_g is null or carbs_g between 0 and 3000),
  fat_g int check (fat_g is null or fat_g between 0 and 1500),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (athlete_id, group_id, effective_from)
);

create index if not exists client_macro_target_history_group_id_idx
  on public.client_macro_target_history(group_id);

alter table public.client_macro_target_history enable row level security;

-- The coach of the group manages targets for athletes who belong to that group, and only those.
create policy "client_macro_target_history_coach_manage" on public.client_macro_target_history for all
  to authenticated
  using (
    public.is_group_coach(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_macro_target_history.group_id
        and gm.profile_id = client_macro_target_history.athlete_id
    )
  )
  with check (
    public.is_group_coach(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_macro_target_history.group_id
        and gm.profile_id = client_macro_target_history.athlete_id
    )
  );

-- The athlete reads their own history (the coach sets it).
create policy "client_macro_target_history_athlete_select" on public.client_macro_target_history for select
  to authenticated
  using (athlete_id = (select auth.uid()));

-- Carry every existing standing target across as the first history row, effective the day it was saved.
insert into public.client_macro_target_history
  (athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g, created_by)
select t.athlete_id, t.group_id, t.updated_at::date, t.calories, t.protein_g, t.carbs_g, t.fat_g, t.updated_by
from public.client_macro_targets t
where exists (
  select 1 from public.group_memberships gm
  where gm.group_id = t.group_id and gm.profile_id = t.athlete_id
)
on conflict do nothing;

-- Tighten the old table the same way so a coach can no longer plant a row for an athlete outside their group.
-- Reads and the athlete's own select policy are unchanged.
drop policy if exists "client_macro_targets_coach_manage" on public.client_macro_targets;
create policy "client_macro_targets_coach_manage" on public.client_macro_targets for all
  to authenticated
  using (
    public.is_group_coach(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_macro_targets.group_id
        and gm.profile_id = client_macro_targets.athlete_id
    )
  )
  with check (
    public.is_group_coach(group_id)
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_macro_targets.group_id
        and gm.profile_id = client_macro_targets.athlete_id
    )
  );

-- Any row already planted for an athlete who isn't in the named group is junk; remove it so the real coach's
-- upsert is not blocked by it.
delete from public.client_macro_targets t
where not exists (
  select 1 from public.group_memberships gm
  where gm.group_id = t.group_id and gm.profile_id = t.athlete_id
);

-- ====================================================================================================
-- migration 0255_legal_acceptances.sql
-- ====================================================================================================

-- Records of what people agreed to: the beta notice, terms, privacy policy and the liability waiver, with the version, the time,
-- the address and device it came from, and (for the waiver) the exact text that was shown. Rows are only ever added.
--
-- Also stops a client changing their own signed waiver: client_intake used to let the athlete rewrite their row at any time
-- (one policy for everything). They can still create it and finish filling it in, but once it is completed it is locked.
-- The signed text itself lives in legal_acceptances, which has no update or delete policy.

create table if not exists public.legal_acceptances (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  document text not null check (document in ('beta_notice', 'terms', 'privacy', 'refunds', 'waiver')),
  version text not null,
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text,
  text_snapshot text,
  unique (profile_id, document, version)
);
create index if not exists legal_acceptances_profile_idx on public.legal_acceptances (profile_id);

alter table public.legal_acceptances enable row level security;
-- A person reads their own acceptances. Nobody writes from the browser: rows are added by the server with the service role.
create policy "legal_acceptances_select_own" on public.legal_acceptances for select
  to authenticated
  using (profile_id = (select auth.uid()));
-- A coach can see the waiver acceptance of their own clients.
create policy "legal_acceptances_select_coach_waiver" on public.legal_acceptances for select
  to authenticated
  using (
    document = 'waiver'
    and exists (
      select 1 from public.client_intake ci
      where ci.athlete_id = legal_acceptances.profile_id and public.is_group_coach(ci.group_id)
    )
  );

-- client_intake: create and complete it, but not rewrite it afterwards, and never delete it.
drop policy if exists "client_intake_write_own" on public.client_intake;
create policy "client_intake_insert_own" on public.client_intake for insert
  to authenticated with check (athlete_id = (select auth.uid()));
create policy "client_intake_update_own_until_completed" on public.client_intake for update
  to authenticated
  using (athlete_id = (select auth.uid()) and completed_at is null)
  with check (athlete_id = (select auth.uid()));

-- ====================================================================================================
-- migration 0256_marketplace_listing_opt_in.sql
-- ====================================================================================================

-- Public coach listing is opt-in. Until now /find-a-coach listed any organization with a coach who had even one program,
-- so a new coach (or a test org) could appear publicly without ever choosing to. Now an organization is listed only after its
-- owner or admin turns it on, and every existing organization starts off.
alter table public.organizations
  add column if not exists listed_in_marketplace boolean not null default false;

-- ====================================================================================================
-- migration 0257_feedback_reports.sql
-- ====================================================================================================

-- "Report a problem or suggest something": a short note from anyone signed in, with the page they were on, which device
-- and screen size they used, so a tester's report can be reproduced. Rows are added by the server (service role) so the
-- address and device are real; only the platform admin reads them.
create table if not exists public.feedback_reports (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'problem' check (kind in ('problem', 'idea')),
  message text not null check (length(message) between 1 and 4000),
  page_path text,
  user_agent text,
  viewport text,
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_reports_created_idx on public.feedback_reports (created_at desc);

alter table public.feedback_reports enable row level security;
create policy "feedback_reports_select_platform_admin" on public.feedback_reports for select
  to authenticated using (coalesce(public.is_platform_admin(), false));
create policy "feedback_reports_update_platform_admin" on public.feedback_reports for update
  to authenticated using (coalesce(public.is_platform_admin(), false)) with check (coalesce(public.is_platform_admin(), false));

-- ====================================================================================================
-- migration 0258_nav_query_log.sql
-- ====================================================================================================

-- What the Ask Spot help layer could not answer, so missing phrasings can be added. Written only by the server (the service
-- role); read only by the platform admin. query_text is normalized with client names, emails and numbers removed, and is
-- only kept for questions the layer did not answer. Answered ones keep just the intent ids. No person id is stored.
create table public.nav_query_log (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  role text not null check (role in ('coach', 'athlete')),
  device text not null check (device in ('desktop', 'phone')),
  outcome text not null check (outcome in ('navigate', 'howto', 'unsure', 'data')),
  intent_ids text[] not null default '{}',
  query_text text
);

create index nav_query_log_created_idx on public.nav_query_log (created_at desc);
create index nav_query_log_outcome_idx on public.nav_query_log (outcome, created_at desc);

alter table public.nav_query_log enable row level security;

create policy "nav_query_log_admin_select" on public.nav_query_log for select
  to authenticated using (public.is_platform_admin());

commit;
