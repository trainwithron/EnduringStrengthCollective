-- Release BP (schema, nothing visible changes): the shared exercise catalog. One platform-wide list of real movements (name, category, equipment), and the other ways each one is written
-- (an alias per spelling). Everyone signed in can read it; only the platform admin can write it. It holds exercise NAMES ONLY: no coach's video, notes, clients or programs. A coach's own
-- exercise_library row stays the coach's own layer on top (their display name, their video) and gains catalog_id, which says which real movement it is. The old per-coach exercise_aliases
-- (what a coach typed -> which of their library exercises) is unchanged.
create table public.exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text,
  equipment text,
  batch text,
  created_at timestamptz not null default now()
);
create unique index exercise_catalog_name_key on public.exercise_catalog (lower(name));

create table public.exercise_catalog_aliases (
  alias_key text primary key check (alias_key = lower(alias_key) and alias_key ~ '^[a-z0-9]+$'),
  catalog_id uuid not null references public.exercise_catalog(id) on delete cascade,
  alias text not null check (char_length(btrim(alias)) between 1 and 120),
  batch text,
  created_at timestamptz not null default now()
);
create index exercise_catalog_aliases_catalog_idx on public.exercise_catalog_aliases (catalog_id);

alter table public.exercise_library add column catalog_id uuid references public.exercise_catalog(id) on delete set null;
create index exercise_library_catalog_idx on public.exercise_library (catalog_id) where catalog_id is not null;

alter table public.exercise_catalog enable row level security;
alter table public.exercise_catalog_aliases enable row level security;
revoke all on public.exercise_catalog from anon;
revoke all on public.exercise_catalog_aliases from anon;

create policy "exercise_catalog_read" on public.exercise_catalog for select to authenticated using (true);
create policy "exercise_catalog_admin_write" on public.exercise_catalog for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "exercise_catalog_aliases_read" on public.exercise_catalog_aliases for select to authenticated using (true);
create policy "exercise_catalog_aliases_admin_write" on public.exercise_catalog_aliases for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
