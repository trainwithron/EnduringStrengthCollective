-- Transformation Cards — private progress-photo journal, weight-loss
-- milestone detection, and the shareable card artifact itself.
-- Photos: private by default, tied to the athlete's own profile. The
-- athlete chooses which specific photos (if any) to share with their
-- coach — nothing is automatically visible just because it exists.
create table public.progress_photos (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  storage_path text not null,
  taken_date date not null default current_date,
  caption text,
  shared_with_coach boolean not null default false,
  created_at timestamptz not null default now()
);
create index progress_photos_athlete_idx on public.progress_photos(athlete_id, taken_date desc);

alter table public.progress_photos enable row level security;
create policy "progress_photos_select_own_or_shared" on public.progress_photos for select
  to authenticated using (
    athlete_id = (select auth.uid())
    or (shared_with_coach and public.is_group_coach(group_id))
  );
create policy "progress_photos_write_own" on public.progress_photos for all
  to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('progress-photos', 'progress-photos', false, 15728640) -- private, 15MB cap (photos, not video)
on conflict (id) do nothing;

create policy "progress_photos_storage_select_own_or_shared" on storage.objects for select
  to authenticated using (
    bucket_id = 'progress-photos'
    and (
      owner = auth.uid()
      or exists (
        select 1 from public.progress_photos p
        where p.storage_path = name and p.shared_with_coach and public.is_group_coach(p.group_id)
      )
    )
  );
create policy "progress_photos_storage_insert_own" on storage.objects for insert
  to authenticated with check (
    bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "progress_photos_storage_delete_own" on storage.objects for delete
  to authenticated using (bucket_id = 'progress-photos' and owner = auth.uid());

-- Dedupe ledger for weight-loss milestone DETECTION only — a row here
-- means "the athlete was shown the prompt," never that a card was
-- actually made or shared. Escalating thresholds (5/10/20/50/75/100/
-- 150/200 lbs), checked against the athlete's own first-ever logged
-- weight as the fixed "from where" reference point (real, immutable,
-- needs no new coach-facing UI).
create table public.transformation_milestones (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  threshold_lbs int not null,
  starting_weight numeric not null,
  current_weight numeric not null,
  detected_at timestamptz not null default now(),
  unique (athlete_id, threshold_lbs)
);
alter table public.transformation_milestones enable row level security;
create policy "transformation_milestones_select_own_or_coach" on public.transformation_milestones for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "transformation_milestones_write_own_or_coach" on public.transformation_milestones for all
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id))
  with check (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

-- The actual shareable artifact — created ONLY when the athlete chooses
-- to make one (a periodic retrospective card can also set milestone_id
-- to null). Photos optional (data-only vs. photo+PR variant); humor
-- defaults on with a per-card override.
create table public.transformation_cards (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  milestone_id uuid references public.transformation_milestones(id) on delete set null,
  starting_weight numeric not null,
  current_weight numeric not null,
  window_start_date date not null,
  window_end_date date not null,
  humor_enabled boolean not null default true,
  before_photo_id uuid references public.progress_photos(id) on delete set null,
  after_photo_id uuid references public.progress_photos(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.transformation_cards enable row level security;
create policy "transformation_cards_select_own_or_coach" on public.transformation_cards for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "transformation_cards_write_own" on public.transformation_cards for all
  to authenticated using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));
