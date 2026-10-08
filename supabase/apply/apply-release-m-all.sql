-- RELEASE M (ACCEPTANCE RECORD IS APPEND-ONLY): ONE paste. Steps 44 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 44: Nothing changes for anyone. Signing up, accepting a new version and the accept screen work exactly as before. What changes: no one, not even the server key, can edit or delete a row of legal_acceptances any more; deleting a person's account still removes their rows.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release M (acceptance record is append-only), step 44: 0299 The record of what people agreed to (beta notice, terms, privacy, waiver) can only be added to: a trigger refuses any change to a row and any truncate, and the app's roles lose update, delete and truncate on it
do $g44$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('legal_acceptances exists (0255)', to_regclass('public.legal_acceptances') is not null),
      ('0299 is not already applied (the append-only trigger is not there yet)', not exists (select 1 from pg_trigger where tgname = 'legal_acceptances_append_only' and tgrelid = 'public.legal_acceptances'::regclass))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release M (acceptance record is append-only), step 44 (0299) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g44$;

-- ====================================================================================================
-- migration 0299_legal_acceptances_append_only.sql
-- ====================================================================================================

-- The record of what people agreed to (legal_acceptances, 0255) is only ever added to. Row security already gave nobody a way to change it from the app, but the table still
-- granted UPDATE, DELETE and TRUNCATE to the app's roles and the server key could rewrite it. Now a trigger refuses any change to a row, and any truncate, for every role
-- including the server key, and the privileges are taken away.
--
-- One door stays open on purpose: deleting a person's account removes their acceptances through the foreign key from profiles. That delete runs inside the cascade's own
-- trigger (trigger depth above 1), so it is allowed; a delete aimed at this table directly is depth 1 and is refused.
-- Nothing the app does today updates or deletes a row (acceptances are added with "on conflict do nothing"), so no feature changes. Re-runnable.

create or replace function public.legal_acceptances_refuse_changes()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  -- A cascade from deleting the person's account (profiles -> legal_acceptances) runs inside another trigger.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Legal acceptances are append-only';
end;
$function$;

revoke all on function public.legal_acceptances_refuse_changes() from public, anon, authenticated;

drop trigger if exists legal_acceptances_append_only on public.legal_acceptances;
create trigger legal_acceptances_append_only
  before update or delete on public.legal_acceptances
  for each row execute function public.legal_acceptances_refuse_changes();

drop trigger if exists legal_acceptances_no_truncate on public.legal_acceptances;
create trigger legal_acceptances_no_truncate
  before truncate on public.legal_acceptances
  for each statement execute function public.legal_acceptances_refuse_changes();

-- People can read their own rows (row security) and the server adds rows; nobody needs the rest.
revoke update, delete, truncate, references, trigger on public.legal_acceptances from anon, authenticated;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 44 (0299)' as step, '0299 The record of what people agreed to' as what, not ((not exists (select 1 from pg_trigger where tgname = 'legal_acceptances_append_only' and tgrelid = 'public.legal_acceptances'::regclass))) as in_place
) as result order by step;
