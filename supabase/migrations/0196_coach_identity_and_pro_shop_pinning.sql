-- coach_identity_bio_social_link_pinning_scoping_sept19.md — a coach
-- bio + full profile photo (deliberately separate from the small
-- avatar_url already used elsewhere per Ron's own "I like a full
-- profile picture" framing), social links folded into the existing
-- Pro Shop system (new 'social' category, no new infrastructure), and
-- a small join table letting a coach pin a specific Pro Shop link to
-- one client's specific calendar day.

create table public.coach_profiles (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  bio text,
  photo_url text,
  updated_at timestamptz not null default now()
);
alter table public.coach_profiles enable row level security;
-- Mirrors athlete_profile_details' own is_coach_of_athlete shape in the
-- opposite direction: any client of this coach (coach-wide, via the
-- already-shipped is_client_of_coach from 0023_booking.sql) can read
-- it; only the coach themselves can write it.
create policy "coach_profiles_select_own_or_client" on public.coach_profiles for select
  to authenticated using (coach_id = (select auth.uid()) or public.is_client_of_coach(coach_id));
create policy "coach_profiles_write_own" on public.coach_profiles for all
  to authenticated using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));

-- Full-size profile photo upload, same shape as pro-shop-images
-- (0082_pro_shop_links.sql) — public bucket, coach-owns-their-own-folder
-- write policies.
insert into storage.buckets (id, name, public, file_size_limit)
values ('coach-profile-photos', 'coach-profile-photos', true, 5242880) -- public, 5MB cap
on conflict (id) do nothing;

create policy "coach_profile_photos_insert_own" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'coach-profile-photos'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );

create policy "coach_profile_photos_update_own" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'coach-profile-photos'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  )
  with check (
    bucket_id = 'coach-profile-photos'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );

create policy "coach_profile_photos_delete_own" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'coach-profile-photos'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );

-- Social links reuse Pro Shop directly — no new infrastructure, same
-- data shape, same click tracking as every other link, per the
-- scoping's own explicit instruction.
alter table public.pro_shop_links drop constraint pro_shop_links_category_check;
alter table public.pro_shop_links add constraint pro_shop_links_category_check
  check (category in ('merch', 'supplements', 'coaching', 'website', 'other', 'social'));

-- Contextual link pinning — a coach pins one Pro Shop link to one
-- specific client's specific calendar day (Ron's own example: an
-- intra-workout carb-supplement link on a heavy-training day). Scoped
-- to a real client + date, mirroring workout_assignments/daily_macros'
-- own per-(athlete, date) shape — nothing like this existed before.
create table public.pro_shop_link_day_pins (
  id uuid primary key default uuid_generate_v4(),
  link_id uuid not null references public.pro_shop_links(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  pin_date date not null,
  created_at timestamptz not null default now(),
  unique (link_id, athlete_id, pin_date)
);
create index pro_shop_link_day_pins_athlete_date_idx on public.pro_shop_link_day_pins(athlete_id, pin_date);

alter table public.pro_shop_link_day_pins enable row level security;
create policy "pro_shop_link_day_pins_select_own_or_coach" on public.pro_shop_link_day_pins for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "pro_shop_link_day_pins_write_coach" on public.pro_shop_link_day_pins for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));
