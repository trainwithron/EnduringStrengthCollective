-- Release V1: a parent or guardian's consent for a client aged 13 to 17 (docs/GUARDIAN_CONSENT_DESIGN.md, docs/research/minor-consent-strictest-state.md).
--
--   guardian_consents          one row per request to a guardian. The row holds the guardian's address, a SHA-256 of the one-time link (never the link), and, once signed, who signed, how they relate to the child, the state
--                              they live in (and that state's age of majority), the exact words they were shown (and the SHA-256 and version of those words), the time, the address and device they signed from, and the
--                              time a copy was emailed to them. Server only: nothing reads or writes it from a browser.
--   guardian_consent_state()   answers, for the child or a coach of the child (or the server), whether a guardian has consented: none / pending / signed / withdrawn, with the guardian's name and address and the times.
--                              It never returns the link hash.
-- Additions only: a table and a function with new names. Re-runnable.
create table if not exists public.guardian_consents (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  guardian_email text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'signed', 'withdrawn', 'replaced')),
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  guardian_name text,
  relationship text,
  residence_state text,
  majority_age int,
  doc_version text,
  doc_sha256 text,
  doc_text text,
  signed_at timestamptz,
  signed_ip text,
  signed_user_agent text,
  copy_emailed_at timestamptz,
  withdrawn_at timestamptz
);
create index if not exists guardian_consents_athlete_idx on public.guardian_consents (athlete_id, created_at desc);
-- a child has at most one live signature at a time
create unique index if not exists guardian_consents_one_signed on public.guardian_consents (athlete_id) where status = 'signed';
alter table public.guardian_consents enable row level security;
revoke all on public.guardian_consents from anon, authenticated;

create or replace function public.guardian_consent_state(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.guardian_consents%rowtype;
begin
  if not (
    auth.role() = 'service_role'
    or (auth.uid() is not null and (
      auth.uid() = p_athlete
      or exists (
        select 1 from public.group_memberships a
        where a.profile_id = p_athlete and a.role = 'athlete' and public.is_group_coach(a.group_id)
      )
    ))
  ) then
    return null;
  end if;
  -- a signature that stands wins; then a request still waiting; then the latest withdrawal
  select * into r from public.guardian_consents where athlete_id = p_athlete and status = 'signed' limit 1;
  if not found then
    select * into r from public.guardian_consents where athlete_id = p_athlete and status = 'pending' and expires_at > now() order by created_at desc limit 1;
  end if;
  if not found then
    select * into r from public.guardian_consents where athlete_id = p_athlete and status = 'withdrawn' order by withdrawn_at desc nulls last limit 1;
  end if;
  if not found then
    return jsonb_build_object('state', 'none');
  end if;
  return jsonb_build_object(
    'state', case r.status when 'signed' then 'signed' when 'pending' then 'pending' else 'withdrawn' end,
    'guardian_email', r.guardian_email,
    'guardian_name', r.guardian_name,
    'relationship', r.relationship,
    'requested_at', r.created_at,
    'expires_at', r.expires_at,
    'signed_at', r.signed_at,
    'withdrawn_at', r.withdrawn_at
  );
end;
$$;
revoke execute on function public.guardian_consent_state(uuid) from public, anon;
grant execute on function public.guardian_consent_state(uuid) to authenticated, service_role;
