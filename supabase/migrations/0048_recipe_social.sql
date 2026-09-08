-- Recipe Hub v1: voting + favoriting on the existing meal-engine recipe
-- database (lib/meal-engine.ts's RECIPE_DATABASE, keyed by its stable
-- string `id`, e.g. "l_chicken_rice"). Deliberately NOT a full
-- crowdsourced/public recipe system yet — that needs the recipe database
-- itself to move into real rows with generic ingredient scaling, a bigger
-- change flagged separately in the long-term backlog. This is just the
-- "objective habit-leaderboard-style" social layer on top of what
-- already exists.
create table public.recipe_votes (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  recipe_id text not null,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (profile_id, recipe_id)
);

alter table public.recipe_votes enable row level security;

-- Vote *tallies* aren't sensitive (no PII beyond a profile_id, and this
-- app already treats plain aggregate counts as fine to read broadly —
-- e.g. reaction counts on feed posts) so any authenticated user can read
-- every vote to compute a net score; writes are restricted to your own.
create policy "recipe_votes_select_all" on public.recipe_votes for select
  to authenticated using (true);

create policy "recipe_votes_write_own" on public.recipe_votes for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create table public.recipe_favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  recipe_id text not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, recipe_id)
);

alter table public.recipe_favorites enable row level security;

-- Unlike votes, whose recipes someone has favorited is personal — only
-- the viewer's own favorites are readable.
create policy "recipe_favorites_own" on public.recipe_favorites for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
