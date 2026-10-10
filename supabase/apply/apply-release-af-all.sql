-- RELEASE AF (A COACH'S OWN WORDING FOR THE SIGN-IN LINK EMAIL): ONE paste. Steps 73 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 73: Nothing changes for anyone. One private table is added. Until a coach writes their own wording the app uses its default message.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AF (a coach's own wording for the sign-in link email), step 73: 0327 Coach message templates: a coach's own wording for the email that carries a client's sign-in link; private to the coach
do $g73$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0327 is not already applied (coach_message_templates does not exist yet)', to_regclass('public.coach_message_templates') is null),
      ('profiles exists', to_regclass('public.profiles') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AF (a coach''s own wording for the sign-in link email), step 73 (0327) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g73$;

-- ====================================================================================================
-- migration 0327_coach_message_templates.sql
-- ====================================================================================================

-- A coach's own wording for the email that carries a client's sign-in link (the app supplies a default; this table holds the coach's version, if they wrote one).
-- One row per coach. The subject and body are plain text with three placeholders: {first_name}, {coach_name} and {link}; the body must contain {link} (checked here and in the
-- app) so a custom message can never go out without the link. Private to the coach (row security: your own row only). Deleting the row is "back to the default".
create table public.coach_message_templates (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  claim_email_subject text not null check (char_length(claim_email_subject) between 1 and 150),
  claim_email_body text not null check (char_length(claim_email_body) between 1 and 2000 and position('{link}' in claim_email_body) > 0),
  updated_at timestamptz not null default now()
);

alter table public.coach_message_templates enable row level security;

create policy "coach_message_templates_own" on public.coach_message_templates for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 73 (0327)' as step, '0327 Coach message templates: a coach''s own wording for the email that carries a client''s sign-in link' as what, not ((to_regclass('public.coach_message_templates') is null)) as in_place
) as result order by step;
