-- RELEASE SP1 (A SUPPORT REPLY TELLS THE OTHER SIDE; ADDS ONE NOTICE KIND AND A TRIGGER, SAFE BEFORE THE CODE): ONE paste. Steps 162 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 162: From now on a coach's new support message tells every platform admin, and an admin's reply tells the coach who opened the request. Nothing changes on screen except the bell. Safe to run before the code (the push needs the Release SP1 code).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release SP1 (a support reply tells the other side; adds one notice kind and a trigger, safe before the code), step 162: 0410 Release SP1: a reply in a support thread tells the other side (a bell notice and a push)
do $g162$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0410 is not already applied (the support notice trigger is not there yet)', not exists (select 1 from pg_trigger where tgname = 'support_messages_notify' and not tgisinternal)),
      ('the support tables exist', to_regclass('public.support_requests') is not null and to_regclass('public.support_messages') is not null and to_regclass('public.notifications') is not null),
      ('the notification type rule exists to be widened', exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release SP1 (a support reply tells the other side; adds one notice kind and a trigger, safe before the code), step 162 (0410) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g162$;

-- ====================================================================================================
-- migration 0410_support_reply_notices.sql
-- ====================================================================================================

-- Release SP1: a reply in a support thread tells the other side.
--
-- The support inbox (a coach writing to the people who run the app) was a thread nobody was told about: a coach's request waited for the platform admin to happen to open the inbox, and the admin's reply waited for the coach to
-- happen to open theirs. Now each new message in a support thread writes one notice (and the five-minute push job sends it, with only "Open the app to read it." on the lock screen):
--   a platform admin wrote            -> the coach who opened the request is told, linking to their Support page (the other admins are not);
--   the coach who opened it wrote     -> every platform admin is told, linking to the admin support inbox;
--   a teammate (another member of the organization) wrote -> the coach who opened it is told "A teammate wrote in your support request", and every platform admin is told too.
-- 'support_reply' is a new kind of notice (the list of allowed kinds is rebuilt from the live one plus this kind, and refused if it would lose any). Additions only. Re-runnable.
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
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['support_reply']) as t;
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

create or replace function public.notify_on_support_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.support_requests%rowtype;
  v_group uuid;
  v_name text;
  v_author_is_admin boolean;
  v_link text;
begin
  select * into req from public.support_requests where id = new.request_id;
  if not found then
    return new;
  end if;
  select coalesce(p.is_platform_admin, false), nullif(btrim(p.full_name), '') into v_author_is_admin, v_name from public.profiles p where p.id = new.author_id;

  -- who is told, by who wrote:
  --   a platform admin wrote            -> the coach who opened the request (not the other admins)
  --   the coach who opened it wrote     -> every platform admin
  --   another member of the organization (a teammate) wrote -> the coach who opened it, as "a teammate wrote", AND every platform admin
  if new.author_id = req.coach_id or not coalesce(v_author_is_admin, false) then
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    select p.id, null, 'support_reply',
           case when new.author_id = req.coach_id then coalesce(v_name, 'A coach') || ' wrote in support: ' || left(req.subject, 120)
                else coalesce(v_name, 'A teammate') || ' wrote in a coach''s support request: ' || left(req.subject, 120) end,
           '/admin/support'
      from public.profiles p
     where p.is_platform_admin and p.id <> new.author_id;
  end if;

  if new.author_id <> req.coach_id then
    select gm.group_id into v_group
      from public.group_memberships gm
      join public.groups g on g.id = gm.group_id
     where gm.profile_id = req.coach_id and gm.role = 'coach' and g.organization_id = req.organization_id
     order by g.created_at
     limit 1;
    v_link := case when v_group is null then '/dashboard' else '/groups/' || v_group || '/business/support' end;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (
      req.coach_id, v_group, 'support_reply',
      case when coalesce(v_author_is_admin, false) then 'Support replied to your request: ' || left(req.subject, 120)
           else 'A teammate wrote in your support request: ' || left(req.subject, 120) end,
      v_link
    );
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_on_support_message() from public, anon, authenticated;

drop trigger if exists support_messages_notify on public.support_messages;
create trigger support_messages_notify
  after insert on public.support_messages
  for each row execute function public.notify_on_support_message();

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 162 (0410)' as step, '0410 Release SP1: a reply in a support thread tells the other side' as what, not ((not exists (select 1 from pg_trigger where tgname = 'support_messages_notify' and not tgisinternal))) as in_place
) as result order by step;
