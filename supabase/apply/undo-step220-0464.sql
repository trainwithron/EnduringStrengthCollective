-- UNDO step 220: removes the voice notes (a voice note message stays as a "Voice note" line with no sound; empty the voice-notes bucket in Storage first and the bucket goes
-- too), the next-try dates on failed payments, and the saved payroll reports (every saved report is lost). Paste and run.
begin;

drop table if exists public.payroll_reports;
drop function if exists public.payroll_reports_frozen();

alter table public.payment_events drop column if exists next_attempt_at;

drop policy if exists "voice_notes_storage_select" on storage.objects;
drop policy if exists "voice_notes_storage_insert" on storage.objects;
drop policy if exists "voice_notes_storage_delete" on storage.objects;
delete from storage.buckets where id = 'voice-notes' and not exists (select 1 from storage.objects where bucket_id = 'voice-notes');

drop trigger if exists direct_messages_guard_voice on public.direct_messages;
drop function if exists public.guard_direct_message_voice();
drop index if exists public.direct_messages_voice_path_key;
alter table public.direct_messages drop constraint if exists direct_messages_voice_check;
alter table public.direct_messages drop column if exists voice_seconds;
alter table public.direct_messages drop column if exists voice_path;

commit;
