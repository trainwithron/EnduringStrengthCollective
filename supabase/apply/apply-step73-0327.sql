-- STEP 73: 0327 Coach message templates: a coach's own wording for the email that carries a client's sign-in link; private to the coach
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for anyone. One private table is added. Until a coach writes their own wording the app uses its default message.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.coach_message_templates') is null)) then
    raise exception 'Step 73 (0327) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
