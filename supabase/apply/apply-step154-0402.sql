-- STEP 154: 0402 Release V1: a parent or guardian's consent for a client aged 13 to 17 (a server-only table of requests and signatures, and one function that says where a client's consent stands)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the Release V1 code is live. Adds one empty server-only table, one function (guardian_consent_state) and a guard on client_intake: once a date of birth is on file, a signed-in client can no longer change it from their browser (a correction goes through support). Apply this BEFORE the Release V1 code is deployed: with the code live, every client aged 13 to 17 is stopped at a permission screen until a parent or guardian signs.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.guardian_consents') is null)) then
    raise exception 'Step 154 (0402) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0402_guardian_consent.sql
-- ====================================================================================================

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
  withdrawn_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null
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
  -- a signature that stands wins; otherwise the latest request that was not replaced: waiting, run out of time ('expired'), or taken back
  select * into r from public.guardian_consents where athlete_id = p_athlete and status = 'signed' limit 1;
  if not found then
    select * into r from public.guardian_consents where athlete_id = p_athlete and status in ('pending', 'withdrawn') order by created_at desc limit 1;
  end if;
  if not found then
    return jsonb_build_object('state', 'none');
  end if;
  return jsonb_build_object(
    'state', case when r.status = 'signed' then 'signed' when r.status = 'withdrawn' then 'withdrawn' when r.expires_at > now() then 'pending' else 'expired' end,
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

-- A client cannot rewrite their own date of birth once it is on file. Without this, a client stopped as under 13 (or without a guardian's permission) could change it to an adult's in their own browser and pass the gate.
-- The first date is the client's own to give; a correction goes through support or the server (the service role has no signed-in person and passes). A coach has no write on this table.
create or replace function public.guard_client_birthday()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;
  if old.date_of_birth is not null and new.date_of_birth is distinct from old.date_of_birth then
    raise exception 'A date of birth that is on file can only be corrected by your coach through support.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_client_birthday() from public, anon, authenticated;
drop trigger if exists client_intake_guard_birthday on public.client_intake;
create trigger client_intake_guard_birthday
  before update of date_of_birth on public.client_intake
  for each row execute function public.guard_client_birthday();

commit;
