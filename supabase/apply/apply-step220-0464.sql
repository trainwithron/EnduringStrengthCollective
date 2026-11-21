-- PASTE: step 220 (voice notes in Messages, the next try on a failed card, and saved payroll reports). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.

begin;

-- Step 220 (Ron, Nov 20: wave 3, business, approved). Three small additions; nothing existing is changed or removed, and no live function is rewritten.
--
-- 1. Voice notes in Messages (R7). A message can carry one short recording (up to 2 minutes): direct_messages.voice_path (where the file is) and voice_seconds (how long it is).
--    The message itself is written exactly as before (the same rules decide who may write to whom, and a minor without a parent's OK still cannot send: 0417's guard covers
--    every new row). The path always starts with the SENDER's own id (sender / space / file), one message per file, and nobody can change either column afterwards.
--    The files live in a NEW private bucket, voice-notes (audio only, 5 MB at most). Only the person who recorded it adds it (into their own folder, in a space they are in,
--    and only when minor_may_write says they may write); only the two people in the conversation read it: the sender (their own folder) and the person it was sent to (a
--    message to them names it). Nobody else, an organization owner included, can open the sound. The sender can remove their own file (a send that failed, or an account
--    deleted: the server removes the files then).
-- 2. Failed card payments ($5): payment_events.next_attempt_at, the date Stripe says it will try the card again (from the failed invoice). Empty when Stripe will not try
--    again, or for an older row. Written only by the server, like the rest of that table.
-- 3. Saved payroll reports ($3): payroll_reports, a frozen copy of a pay period from Coach activity (the dates, each coach's numbers, the rates typed, the pay lines and the
--    sessions behind them, exactly as shown), with a note. Only the server writes it (after checking the person is an owner or admin of the organization); the owner and
--    admins of that organization read it; nobody changes it once saved (a trigger refuses every change, the server included), so it never moves when sessions change later.
-- Re-running is safe.

-- ---- 1. voice notes ------------------------------------------------------------------------------------------------------------------------------------------------------
alter table public.direct_messages add column if not exists voice_path text;
alter table public.direct_messages add column if not exists voice_seconds int;

do $voice$
begin
  if not exists (select 1 from pg_constraint where conname = 'direct_messages_voice_check' and conrelid = 'public.direct_messages'::regclass) then
    alter table public.direct_messages add constraint direct_messages_voice_check check (
      (voice_path is null and voice_seconds is null)
      or (
        voice_path is not null
        and voice_seconds is not null
        and voice_seconds between 1 and 120
        and voice_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|m4a|ogg)$'
        and split_part(voice_path, '/', 1) = sender_id::text
        and split_part(voice_path, '/', 2) = group_id::text
      )
    );
  end if;
end
$voice$;
create unique index if not exists direct_messages_voice_path_key on public.direct_messages (voice_path) where voice_path is not null;

-- nobody changes a voice note after it is sent (the recipient may still mark the message read)
create or replace function public.guard_direct_message_voice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.voice_path := old.voice_path;
    new.voice_seconds := old.voice_seconds;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_direct_message_voice() from public, anon, authenticated;

drop trigger if exists direct_messages_guard_voice on public.direct_messages;
create trigger direct_messages_guard_voice
  before update on public.direct_messages
  for each row execute function public.guard_direct_message_voice();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-notes', 'voice-notes', false, 5242880, array['audio/webm', 'audio/mp4', 'audio/ogg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "voice_notes_storage_select" on storage.objects;
create policy "voice_notes_storage_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-notes'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.direct_messages dm where dm.voice_path = objects.name and dm.recipient_id = (select auth.uid()))
    )
  );
drop policy if exists "voice_notes_storage_insert" on storage.objects;
create policy "voice_notes_storage_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and case when (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$' then public.is_group_member(((storage.foldername(name))[2])::uuid) else false end
    and public.minor_may_write((select auth.uid()))
  );
drop policy if exists "voice_notes_storage_delete" on storage.objects;
create policy "voice_notes_storage_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---- 2. the next try on a failed card ------------------------------------------------------------------------------------------------------------------------------------
alter table public.payment_events add column if not exists next_attempt_at timestamptz;

-- ---- 3. saved payroll reports --------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.payroll_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  from_day date not null,
  to_day date not null,
  time_zone text not null,
  note text check (note is null or char_length(note) <= 1000),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  check (to_day >= from_day)
);
create index if not exists payroll_reports_org_idx on public.payroll_reports (organization_id, created_at desc);
alter table public.payroll_reports enable row level security;
revoke all on public.payroll_reports from anon, authenticated;
grant select on public.payroll_reports to authenticated;
drop policy if exists "payroll_reports_read_owner_admin" on public.payroll_reports;
create policy "payroll_reports_read_owner_admin" on public.payroll_reports for select to authenticated
  using (public.is_org_owner_or_admin(organization_id));

-- a saved report is never changed, by anyone
create or replace function public.payroll_reports_frozen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'A saved payroll report cannot be changed.';
end;
$$;
revoke all on function public.payroll_reports_frozen() from public, anon, authenticated;

drop trigger if exists payroll_reports_frozen on public.payroll_reports;
create trigger payroll_reports_frozen
  before update on public.payroll_reports
  for each row execute function public.payroll_reports_frozen();

commit;

-- check: one row, every column true
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'direct_messages' and column_name in ('voice_path', 'voice_seconds')) = 2 as voice_columns,
  exists (select 1 from pg_constraint where conname = 'direct_messages_voice_check' and conrelid = 'public.direct_messages'::regclass)
    and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'direct_messages' and indexname = 'direct_messages_voice_path_key') as voice_path_rules,
  exists (select 1 from pg_trigger where tgname = 'direct_messages_guard_voice' and tgrelid = 'public.direct_messages'::regclass) as voice_kept_as_sent,
  exists (select 1 from storage.buckets where id = 'voice-notes' and not public) as voice_bucket_private,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('voice_notes_storage_select', 'voice_notes_storage_insert', 'voice_notes_storage_delete')) = 3 as voice_storage_rules,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_events' and column_name = 'next_attempt_at') as next_try_column,
  (select relrowsecurity from pg_class where oid = 'public.payroll_reports'::regclass)
    and has_table_privilege('authenticated', 'public.payroll_reports', 'select')
    and not has_table_privilege('authenticated', 'public.payroll_reports', 'insert')
    and not has_table_privilege('authenticated', 'public.payroll_reports', 'update')
    and not has_table_privilege('authenticated', 'public.payroll_reports', 'delete')
    and not has_table_privilege('anon', 'public.payroll_reports', 'select') as payroll_server_writes_only,
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payroll_reports' and policyname = 'payroll_reports_read_owner_admin') as payroll_owner_admin_reads,
  exists (select 1 from pg_trigger where tgname = 'payroll_reports_frozen' and tgrelid = 'public.payroll_reports'::regclass) as payroll_never_changes;
