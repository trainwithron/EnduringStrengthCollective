-- STEP 163: 0411 Release CM1: report a post or comment, and block a member (two small tables, two functions, one new kind of notice)
--
-- !! This REBUILDS the list of allowed notice kinds (adds one: content_reported). It refuses to run if the live list cannot be read or would lose a kind, and changes nothing in that case.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the Release CM1 code is live. Adds user_blocks (a member's own list of people they have stopped seeing), content_reports (reports of posts and comments, read by the group's coaches) and the functions report_content and handle_content_report. Safe to run before the code.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.content_reports') is null)) then
    raise exception 'Step 163 (0411) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0411_report_and_block.sql
-- ====================================================================================================

-- Release CM1: report a post or comment, and block a member, in the group feed.
--
-- Until now the feed had no way to say "this is not okay": a post or comment could only be deleted by a coach who happened to see it, and a member could not stop seeing someone. Two things, both small:
--   Block   a member can stop seeing another member's posts and comments (their own choice, nobody is told; it does not change anything for anyone else). user_blocks holds one row per block, readable and writable only by the blocker.
--   Report  any member of a group can report a post or comment in it with a reason. content_reports holds the report. WHO handles a report is a safety rule, not a convenience:
--             - the coaches of the group, EXCEPT the person reported (a report about a coach never goes to that coach);
--             - if there is no other coach, the owner or admins of the organization (again never the person reported);
--             - if there are none, the platform administrators.
--           Whoever handles reports can read them, is told, and can mark them handled or remove the post or comment. Nobody, handler or not, can read WHO reported: the reporter's id is in a column nobody can select, and no notice
--           names the reporter. The report keeps a short copy of what was reported (the first 300 characters, whether it was a post or a comment) so removing the post does not erase the record of what happened.
--           A reporter can file at most 20 reports in 24 hours, and never the same open report twice.
-- 'content_reported' is a new kind of bell notice (the list of allowed kinds is rebuilt from the live one plus this kind, and refused if it would lose any). Nothing is deleted automatically. Additions only. Re-runnable.
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
  -- the post or comment reported; empty once it has been removed (the copy below stays)
  post_id uuid references public.posts(id) on delete set null,
  comment_id uuid references public.comments(id) on delete set null,
  content_kind text not null check (content_kind in ('post', 'comment')),
  content_excerpt text,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'handled')),
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists content_reports_one_open_post on public.content_reports (reporter_id, post_id) where post_id is not null and status = 'open';
create unique index if not exists content_reports_one_open_comment on public.content_reports (reporter_id, comment_id) where comment_id is not null and status = 'open';
create index if not exists content_reports_group_idx on public.content_reports (group_id, status, created_at desc);
create index if not exists content_reports_reporter_idx on public.content_reports (reporter_id, created_at desc);
alter table public.content_reports enable row level security;
revoke all on public.content_reports from anon, authenticated;
-- Everything EXCEPT reporter_id may be read (and only by those who handle reports, below): nobody can learn who reported.
grant select (id, group_id, reported_author_id, post_id, comment_id, content_kind, content_excerpt, reason, status, handled_by, handled_at, removed_at, removed_by, created_at) on public.content_reports to authenticated;

-- Who handles a report about p_author in p_group: the group's coaches other than the person reported; if none, the organization's owner and admins (other than them); if none, the platform administrators.
-- A space that is private from the organization (a one-on-one client who keeps their records private from it) NEVER goes to the organization's owner and admins: with no other coach it goes straight to the platform administrators.
create or replace function public.content_report_handlers(p_group uuid, p_author uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with coaches as (
    select gm.profile_id as id from public.group_memberships gm where gm.group_id = p_group and gm.role = 'coach' and gm.profile_id is distinct from p_author
  ), org_admins as (
    select om.profile_id as id from public.organization_memberships om join public.groups g on g.organization_id = om.organization_id
     where g.id = p_group and om.role in ('owner', 'admin') and om.profile_id is distinct from p_author
       and not public.is_group_private_from_org(p_group)
  ), platform as (
    select p.id from public.profiles p where p.is_platform_admin and p.id is distinct from p_author
  )
  select id from coaches
  union all select id from org_admins where not exists (select 1 from coaches)
  union all select id from platform where not exists (select 1 from coaches) and not exists (select 1 from org_admins)
$$;
revoke execute on function public.content_report_handlers(uuid, uuid) from public, anon, authenticated;
grant execute on function public.content_report_handlers(uuid, uuid) to service_role;

create or replace function public.can_handle_content_report(p_group uuid, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (select 1 from public.content_report_handlers(p_group, p_author) h where h = auth.uid())
$$;
revoke execute on function public.can_handle_content_report(uuid, uuid) from public, anon;
grant execute on function public.can_handle_content_report(uuid, uuid) to authenticated, service_role;

drop policy if exists "content_reports_select" on public.content_reports;
create policy "content_reports_select" on public.content_reports for select to authenticated
  using (public.can_handle_content_report(group_id, reported_author_id));

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
  v_body text;
  v_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  h uuid;
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
    select group_id, author_id, body into v_group, v_author, v_body from public.posts where id = p_post;
  else
    select p.group_id, c.author_id, c.post_id, c.body into v_group, v_author, v_post, v_body from public.comments c join public.posts p on p.id = c.post_id where c.id = p_comment;
  end if;
  if v_group is null or not exists (select 1 from public.group_memberships gm where gm.group_id = v_group and gm.profile_id = me) then
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
  if (select count(*) from public.content_reports where reporter_id = me and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'You have sent a lot of reports today. Please try again tomorrow.';
  end if;
  begin
    insert into public.content_reports (group_id, reporter_id, reported_author_id, post_id, comment_id, content_kind, content_excerpt, reason)
    values (v_group, me, v_author, p_post, p_comment, case when p_post is not null then 'post' else 'comment' end, left(coalesce(v_body, ''), 300), v_reason)
    returning id into v_id;
  exception when unique_violation then
    -- a double tap or a second request at the same moment: the report that won is the answer
    select id into v_id from public.content_reports
     where reporter_id = me and status = 'open' and post_id is not distinct from p_post and comment_id is not distinct from p_comment;
    return v_id;
  end;
  -- Those who handle reports are told (never the person reported, never the reporter, and no notice names the reporter).
  for h in select x from public.content_report_handlers(v_group, v_author) x where x <> me loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (
      h, v_group, 'content_reported', 'A post or comment in a group was reported. Open it to review.',
      case when exists (select 1 from public.group_memberships gm where gm.group_id = v_group and gm.profile_id = h)
             or public.is_org_admin_of_group_for(h, v_group)
           then '/groups/' || v_group || '/feed?highlight=' || v_post::text
           else '/reports' end
    );
  end loop;
  return v_id;
end;
$$;
revoke execute on function public.report_content(uuid, uuid, text) from public, anon;
grant execute on function public.report_content(uuid, uuid, text) to authenticated, service_role;

-- Is p_profile an owner or admin of the organization of p_group? (is_org_admin_of_group answers for the signed-in person only; this answers for the one named, for the notice link.)
create or replace function public.is_org_admin_of_group_for(p_profile uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships om join public.groups g on g.organization_id = om.organization_id
     where g.id = p_group and om.profile_id = p_profile and om.role in ('owner', 'admin')
  )
$$;
revoke execute on function public.is_org_admin_of_group_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_org_admin_of_group_for(uuid, uuid) to service_role;

-- A handler marks a report handled (after removing the post, or deciding it is fine). Never the person reported.
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
  if not found or not public.can_handle_content_report(r.group_id, r.reported_author_id) then
    raise exception 'That report was not found.';
  end if;
  -- (someone else may have handled it a moment ago; marking it again changes nothing)
  update public.content_reports set status = 'handled', handled_by = auth.uid(), handled_at = now() where id = p_report and status = 'open';
end;
$$;
revoke execute on function public.handle_content_report(uuid) from public, anon;
grant execute on function public.handle_content_report(uuid) to authenticated, service_role;

-- A handler removes the reported post or comment for everyone (a comment's replies go with it) and the report is marked handled, keeping the copy of what was reported. Never the person reported.
create or replace function public.remove_reported_content(p_report uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.content_reports%rowtype;
  v_replies integer := 0;
begin
  select * into r from public.content_reports where id = p_report for update;
  if not found or not public.can_handle_content_report(r.group_id, r.reported_author_id) then
    raise exception 'That report was not found.';
  end if;
  -- Two people can have the panel open: if one already decided (left it up, or removed it), the other's stale click must not delete what the first chose to keep.
  if r.status <> 'open' then
    raise exception 'This report was already handled.';
  end if;
  if r.comment_id is not null then
    select count(*) into v_replies from public.comments where parent_comment_id = r.comment_id;
    delete from public.comments where id = r.comment_id;
  elsif r.post_id is not null then
    delete from public.posts where id = r.post_id;
  end if;
  update public.content_reports set status = 'handled', handled_by = auth.uid(), handled_at = coalesce(handled_at, now()), removed_at = now(), removed_by = auth.uid() where id = p_report and status = 'open';
  return v_replies;
end;
$$;
revoke execute on function public.remove_reported_content(uuid) from public, anon;
grant execute on function public.remove_reported_content(uuid) to authenticated, service_role;

-- How many replies a reported comment has, for the "this also removes N replies" line in the confirm (only for those who handle the report).
create or replace function public.reported_comment_reply_count(p_report uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.content_reports%rowtype;
begin
  select * into r from public.content_reports where id = p_report;
  if not found or not public.can_handle_content_report(r.group_id, r.reported_author_id) or r.comment_id is null then
    return 0;
  end if;
  return (select count(*)::integer from public.comments where parent_comment_id = r.comment_id);
end;
$$;
revoke execute on function public.reported_comment_reply_count(uuid) from public, anon;
grant execute on function public.reported_comment_reply_count(uuid) to authenticated, service_role;

commit;
