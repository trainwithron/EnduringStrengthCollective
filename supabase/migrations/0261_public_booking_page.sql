-- A coach's public booking page (/book/their-name): anyone can pick a session type and a time without an account.
--
--   * coach_booking_pages: the coach's own address (slug), whether the page is on (off until they switch it on), a headline
--     and intro, and whether prices are shown (off by default).
--   * session_types gains what a visitor needs to see: length, where it happens (in person / online / either), an optional
--     description, an optional DISPLAY price (never charged by this page), whether it is offered publicly (off by default)
--     and an order.
--   * bookings.session_type_id / booked_via: which kind of session, and who booked it (coach, client or the public page).
--   * booking_manage_links: one row per public booking holding the visitor's contact details and the HASH of their private
--     manage link (change or cancel without an account). The link itself is only ever shown to the visitor once and emailed
--     when a sender is set up.
-- A visitor's contact details are never readable by anyone but the coach: there is no anon access to any of these tables.
-- The public pages read and write through the server (service role) only. Requires 0180 and 0210.

create table public.coach_booking_pages (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  slug text not null unique,
  enabled boolean not null default false,
  headline text,
  intro text,
  show_prices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_booking_pages_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
);

alter table public.coach_booking_pages enable row level security;
create policy "coach_booking_pages_coach_manage" on public.coach_booking_pages for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));

alter table public.session_types
  add column if not exists duration_minutes int not null default 60 check (duration_minutes between 5 and 480),
  add column if not exists location_kind text not null default 'in_person' check (location_kind in ('in_person', 'online', 'either')),
  add column if not exists location_text text,
  add column if not exists description text,
  add column if not exists display_price_cents int check (display_price_cents is null or display_price_cents >= 0),
  add column if not exists public_visible boolean not null default false,
  add column if not exists sort_order int not null default 0;

alter table public.bookings
  add column if not exists session_type_id uuid references public.session_types(id) on delete set null,
  add column if not exists booked_via text check (booked_via is null or booked_via in ('coach', 'client', 'public_page'));

create table public.booking_manage_links (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  guest_name text not null,
  guest_email text not null,
  guest_phone text,
  note text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index booking_manage_links_coach_email_idx on public.booking_manage_links (coach_id, lower(guest_email));
create index booking_manage_links_booking_idx on public.booking_manage_links (booking_id);

alter table public.booking_manage_links enable row level security;
-- The coach can read the details of people who booked with them. Nobody else, and nobody can write directly.
create policy "booking_manage_links_coach_select" on public.booking_manage_links for select
  to authenticated using (coach_id = (select auth.uid()));
