-- Release TC3: ONE invitation link per invited person. Until now an invitation was a one-time link made by the auth service: an email scanner or a message preview "opened" it and used it up (Kade Thompson's link was used
-- 13 seconds after it was made, by nobody), and sending the email again or copying the link made a NEW link and cancelled the old one.
--
-- coach_join_links holds one row per invited person and organization: the link is /join-coach/<id>.<signature>, where the signature is made by the server from the id and a server secret, so NO link or secret is stored here:
-- a copy of this table alone gives nobody a working link. The same link is in the email and the one an administrator copies for a text message; sending the email again keeps it and only moves its end date out (14 days);
-- it stops working when it is used (a password chosen on the join page: opening the link changes nothing), cancelled or expired. A person who has signed in already gets a link of kind 'signin' that is only ever emailed to
-- their own address, never shown to the administrator. Only the server touches the table (row security on, no policy for anyone). Adds one table and two indexes. Re-runnable.
create table if not exists public.coach_join_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'invite' check (kind in ('invite', 'signin')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
-- at most ONE open link per person and organization (a second one cannot be made while one is open; the first is extended instead)
create unique index if not exists coach_join_links_one_open on public.coach_join_links (profile_id, organization_id) where used_at is null and revoked_at is null;
create index if not exists coach_join_links_org_idx on public.coach_join_links (organization_id);
alter table public.coach_join_links enable row level security;
revoke all on public.coach_join_links from anon, authenticated;
