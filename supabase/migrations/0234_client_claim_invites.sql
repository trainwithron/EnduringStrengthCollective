-- Pre-signup client profiles. A coach can create a client (a REAL account,
-- silently, no email sent), build their programs, schedule and meal plans,
-- and only later hand them a single-use claim link. This adds:
--   profiles.claimed_at  null = the person has never signed in / claimed it
--   client_invites       the claim links a coach has created (hashed, single
--                        use, expiring); written only by the server
-- Existing accounts are all treated as claimed.

alter table public.profiles add column if not exists claimed_at timestamptz;

update public.profiles set claimed_at = created_at where claimed_at is null;

-- Every ordinary signup path creates a profile for someone who is signing
-- in right now, so new rows default to claimed. The silent coach-created
-- path inserts claimed_at = null explicitly.
alter table public.profiles alter column claimed_at set default now();

create table public.client_invites (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  -- sha256 of the token in the link; the token itself is never stored.
  token_hash text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index client_invites_athlete_idx on public.client_invites (athlete_id, created_at desc);

alter table public.client_invites enable row level security;

-- A coach can see the invites for their own clients (to show "invite link
-- created"); nobody can write directly — the server does, with the
-- service role, after checking the caller coaches that client.
create policy "client_invites_select_coach" on public.client_invites for select
  to authenticated
  using (coalesce(public.is_coach_of_athlete(athlete_id), false));
