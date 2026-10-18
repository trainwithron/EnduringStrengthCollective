-- RELEASE CM1 (REPORT A POST OR COMMENT, BLOCK A MEMBER; ADDS TWO SMALL TABLES, TWO FUNCTIONS AND ONE NOTICE KIND, SAFE BEFORE THE CODE): ONE paste. Steps 163 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 163: Nothing changes on screen until the Release CM1 code is live. Adds user_blocks (a member's own list of people they have stopped seeing), content_reports (reports of posts and comments, read by the group's coaches) and the functions report_content and handle_content_report. Safe to run before the code.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CM1 (report a post or comment, block a member; adds two small tables, two functions and one notice kind, safe before the code), step 163: 0411 Release CM1: report a post or comment, and block a member (two small tables, two functions, one new kind of notice)
do $g163$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0411 is not already applied (the reports table is not there yet)', to_regclass('public.content_reports') is null),
      ('the tables and helpers it uses exist', to_regclass('public.posts') is not null and to_regclass('public.comments') is not null and to_regclass('public.groups') is not null and to_regclass('public.group_memberships') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null),
      ('the notification type rule exists to be widened', exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CM1 (report a post or comment, block a member; adds two small tables, two functions and one notice kind, safe before the code), step 163 (0411) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g163$;

-- ====================================================================================================
-- migration 0411_report_and_block.sql
-- ====================================================================================================

-- Release CM1: report a post or comment, and block a member, in the group feed.
--
-- Until now the feed had no way to say "this is not okay": a post or comment could only be deleted by a coach who happened to see it, and a member could not stop seeing someone. Two things, both small:
--   Block   a member can stop seeing another member's posts and comments (their own choice, nobody is told; it does not change anything for anyone else). user_blocks holds one row per block, readable and writable only by the blocker.
--   Report  any member of a group can report a post or comment in it with a reason. content_reports holds the report; the group's coaches read the reports of their groups and mark them handled. The reporter is never shown to
--           the person reported. Reporting goes through report_content(), which checks the person is a member of that group, is not reporting themselves, and never files the same open report twice.
--           The coaches of the group get a bell notice ('content_reported', a new kind of notice; the list of allowed kinds is rebuilt from the live one plus this kind and refused if it would lose any).
-- A coach can already delete a post or comment (that is how a report is acted on); nothing is deleted automatically. Additions only. Re-runnable.
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon;
revoke truncate, references, trigger on public.user_blocks from authenticated;
drop policy if exists "user_blocks_own" on public.user_blocks;
create policy "user_blocks_own" on public.user_blocks for all to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_author_id uuid references public.profiles(id) on delete set null,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'handled')),
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  check ((post_id is not null) <> (comment_id is not null))
);
create unique index if not exists content_reports_one_open_post on public.content_reports (reporter_id, post_id) where post_id is not null and status = 'open';
create unique index if not exists content_reports_one_open_comment on public.content_reports (reporter_id, comment_id) where comment_id is not null and status = 'open';
create index if not exists content_reports_group_idx on public.content_reports (group_id, status, created_at desc);
alter table public.content_reports enable row level security;
revoke all on public.content_reports from anon, authenticated;
grant select on public.content_reports to authenticated;
-- Read: the group's coaches, and the person who filed it (nobody else, so the person reported never sees who reported them).
drop policy if exists "content_reports_select" on public.content_reports;
create policy "content_reports_select" on public.content_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_group_coach(group_id));

do $wall$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'content_reports' and policyname = 'org_wall_header') then
    create policy "org_wall_header" on public.content_reports as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$wall$;

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
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['content_reported']) as t;
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

-- File a report. Returns the report's id (the one already open, if this person already reported this).
create or replace function public.report_content(p_post uuid, p_comment uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_group uuid;
  v_author uuid;
  v_post uuid := p_post;
  v_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if me is null then
    raise exception 'Sign in to report something.';
  end if;
  if (p_post is null) = (p_comment is null) then
    raise exception 'Say which post or comment you are reporting.';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'Tell us why, in a sentence (up to 500 characters).';
  end if;
  if p_post is not null then
    select group_id, author_id into v_group, v_author from public.posts where id = p_post;
  else
    select p.group_id, c.author_id, c.post_id into v_group, v_author, v_post from public.comments c join public.posts p on p.id = c.post_id where c.id = p_comment;
  end if;
  if v_group is null then
    raise exception 'That post or comment was not found.';
  end if;
  if not exists (select 1 from public.group_memberships gm where gm.group_id = v_group and gm.profile_id = me) then
    raise exception 'That post or comment was not found.';
  end if;
  if v_author = me then
    raise exception 'You can''t report your own post.';
  end if;
  select id into v_id from public.content_reports
   where reporter_id = me and status = 'open' and post_id is not distinct from p_post and comment_id is not distinct from p_comment;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.content_reports (group_id, reporter_id, reported_author_id, post_id, comment_id, reason)
  values (v_group, me, v_author, p_post, p_comment, v_reason)
  returning id into v_id;
  -- the group's coaches are told (never the person reported, and never the reporter's name in the notice)
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  select gm.profile_id, v_group, 'content_reported', 'A post or comment in your group was reported. Open it to review.', '/groups/' || v_group || '/feed?highlight=' || v_post::text
    from public.group_memberships gm
   where gm.group_id = v_group and gm.role = 'coach' and gm.profile_id <> me;
  return v_id;
end;
$$;
revoke execute on function public.report_content(uuid, uuid, text) from public, anon;
grant execute on function public.report_content(uuid, uuid, text) to authenticated, service_role;

-- A coach marks a report handled (after removing the post, or deciding it is fine).
create or replace function public.handle_content_report(p_report uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.content_reports%rowtype;
begin
  select * into r from public.content_reports where id = p_report for update;
  if not found or auth.uid() is null or not public.is_group_coach(r.group_id) then
    raise exception 'That report was not found.';
  end if;
  update public.content_reports set status = 'handled', handled_by = auth.uid(), handled_at = now() where id = p_report and status = 'open';
end;
$$;
revoke execute on function public.handle_content_report(uuid) from public, anon;
grant execute on function public.handle_content_report(uuid) to authenticated, service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 163 (0411)' as step, '0411 Release CM1: report a post or comment' as what, not ((to_regclass('public.content_reports') is null)) as in_place
) as result order by step;
