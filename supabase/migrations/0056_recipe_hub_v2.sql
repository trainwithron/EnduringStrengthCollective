-- Recipe Hub v2: turns the coach's own custom recipes into real rows
-- instead of only the hardcoded RECIPE_DATABASE in lib/meal-engine.ts.
-- Coach-scoped like exercise_library/movement_patterns (personal library,
-- readable by that coach's own clients) — not a cross-coach public catalog,
-- matching every other "library" table in this app.
--
-- Ingredient math is deliberately simpler than the hand-tuned
-- RECIPE_DATABASE builders (which juggle multiple interacting ingredient
-- swaps per macro): each recipe has at most one adjustable ingredient per
-- macro role, solved directly from the target and a per-100g density —
-- see lib/recipe-scaling.ts. Anything needing the old builders' bespoke
-- swap logic (different fruit by carb threshold, liquid-vs-solid fat,
-- etc.) stays exclusive to the hardcoded recipes; this is the honest,
-- generically-buildable slice of "coach submits their own recipe."
create table public.recipes (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slot text not null default 'any' check (slot in ('breakfast', 'lunch', 'dinner', 'snack', 'any')),
  archetypes text[] not null default array['omnivore'],
  keywords text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_recipes_created_by on public.recipes(created_by);

create table public.recipe_ingredients (
  id uuid primary key default uuid_generate_v4(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  sort_order int not null default 0,
  label text not null,
  role text not null check (role in ('protein_source', 'carb_source', 'fat_source', 'fixed')),
  protein_per_100g numeric not null default 0,
  carbs_per_100g numeric not null default 0,
  fat_per_100g numeric not null default 0,
  -- Only used when role = 'fixed' — a static line with no macro math,
  -- e.g. "1-2 cups steamed vegetables". Adjustable ingredients (the other
  -- three roles) always render as a computed gram amount instead.
  fixed_display_text text
);

create index idx_recipe_ingredients_recipe on public.recipe_ingredients(recipe_id);

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;

-- Same shape as exercise_library: owner manages their own; any athlete who
-- shares a group with that coach can read (needed so recipes actually show
-- up when generating that client's meal plan).
create policy "recipes_select_own_or_group_member" on public.recipes for select
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.group_memberships gm_coach
      join public.group_memberships gm_viewer on gm_viewer.group_id = gm_coach.group_id
      where gm_coach.profile_id = recipes.created_by
        and gm_coach.role = 'coach'
        and gm_viewer.profile_id = auth.uid()
    )
  );

create policy "recipes_write_own" on public.recipes for all
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "recipe_ingredients_select_own_or_group_member" on public.recipe_ingredients for select
  to authenticated
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id
        and (
          r.created_by = auth.uid()
          or exists (
            select 1 from public.group_memberships gm_coach
            join public.group_memberships gm_viewer on gm_viewer.group_id = gm_coach.group_id
            where gm_coach.profile_id = r.created_by
              and gm_coach.role = 'coach'
              and gm_viewer.profile_id = auth.uid()
          )
        )
    )
  );

create policy "recipe_ingredients_write_own" on public.recipe_ingredients for all
  to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.created_by = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.created_by = auth.uid()));
