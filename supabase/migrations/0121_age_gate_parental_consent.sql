-- Age gate + COPPA parental-consent workaround. date_of_birth is
-- collected as the first step of the existing intake flow
-- (client_intake), self-reported like the rest of that table. Whether
-- consent has been verified lives in a SEPARATE table, coach-write-only
-- — a minor certifying their own parent's consent would defeat the
-- entire point, and mixing that write model into client_intake's
-- athlete-write-only RLS can't be expressed cleanly.

alter table public.client_intake add column date_of_birth date;

create table public.minor_consent (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  verified boolean not null default false,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  method text check (method in ('signed_form', 'phone_or_video_call', 'email', 'other')),
  notes text,
  updated_at timestamptz not null default now()
);
create index minor_consent_group_id_idx on public.minor_consent(group_id);

alter table public.minor_consent enable row level security;

-- The athlete needs read access too — /intake renders under their own
-- session and has to check whether consent is verified yet to decide
-- whether to unlock the rest of the form. Read-only for them; every
-- write requires is_group_coach, never athlete_id = auth.uid().
create policy "minor_consent_select_own_or_coach" on public.minor_consent for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "minor_consent_write_coach_only" on public.minor_consent for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
