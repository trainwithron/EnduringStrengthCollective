-- Release Y: a coach's one short public page ("My website", shown at /c/<their booking address>) and featured Pro Shop cards.
--   * coach_sites: one row per coach with what the coach typed (a headline, a short About with two small prompts, up to 3 "why pick me" lines, up to 3 short reviews typed by the coach with
--     a first name, a hero photo and a cover photo path) and a background choice. It is private: only the coach can read or write their own row. The public page reads PUBLISHED rows only,
--     through the server, so unpublished text is never exposed. Nothing is public until the coach switches Publish on (it starts off).
--   * pro_shop_links.featured: the coach marks 2-3 Pro Shop cards to show on that page (and first in the client's Pro Shop). Default off, so nothing changes until they choose.
-- No data is touched. Re-runnable.

create table if not exists public.coach_sites (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  headline text check (headline is null or char_length(headline) <= 120),
  who_i_help text check (who_i_help is null or char_length(who_i_help) <= 300),
  what_i_do text check (what_i_do is null or char_length(what_i_do) <= 600),
  why_lines text[] not null default '{}' check (cardinality(why_lines) <= 3),
  reviews jsonb not null default '[]'::jsonb check (jsonb_typeof(reviews) = 'array' and jsonb_array_length(reviews) <= 3),
  hero_path text,
  cover_path text,
  background text not null default 'dark' check (background in ('dark', 'light', 'brand')),
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.coach_sites enable row level security;
revoke all on public.coach_sites from anon;

drop policy if exists coach_sites_own on public.coach_sites;
create policy coach_sites_own on public.coach_sites for all to authenticated
  using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));

alter table public.pro_shop_links add column if not exists featured boolean not null default false;
