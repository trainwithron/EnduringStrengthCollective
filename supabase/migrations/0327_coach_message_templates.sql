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
