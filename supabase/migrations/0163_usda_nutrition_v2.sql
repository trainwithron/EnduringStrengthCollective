-- Food logging V2, first slice: USDA reference tables + coach-side
-- ingredient-to-USDA mapping + the Standard/Youth-Team nutrition mode
-- toggle. See calorie_tracking_ux_research_and_plan.md.

-- Real USDA FoodData Central reference data (Foundation + SR Legacy),
-- downloaded-and-cached, never a live per-request API call. Public
-- reference data — readable by any authenticated user, written only by
-- migrations/seed scripts (no authenticated write policy at all).
create table public.usda_foods (
  fdc_id integer primary key,
  description text not null,
  data_type text not null check (data_type in ('Foundation', 'SR Legacy')),
  food_category text,
  created_at timestamptz not null default now()
);

create table public.usda_food_nutrients (
  id uuid primary key default uuid_generate_v4(),
  fdc_id integer not null references public.usda_foods(fdc_id) on delete cascade,
  -- Matches lib/nutrient-keys.ts's canonical Key-12 + macro key set
  -- (e.g. "protein_g", "fiber_g", "vitamin_d_mcg") — not the raw USDA
  -- nutrient name, so read-side code never has to know USDA's naming.
  nutrient_key text not null,
  amount_per_100g numeric not null,
  unique (fdc_id, nutrient_key)
);
create index usda_food_nutrients_fdc_id_idx on public.usda_food_nutrients(fdc_id);

alter table public.usda_foods enable row level security;
create policy "usda_foods_select_all" on public.usda_foods for select to authenticated using (true);

alter table public.usda_food_nutrients enable row level security;
create policy "usda_food_nutrients_select_all" on public.usda_food_nutrients for select to authenticated using (true);

-- Coach-side mapping for the 24 built-in RECIPE_DATABASE recipes' shared
-- FOOD_DENSITY vocabulary (lib/meal-engine.ts) — one row per food-density
-- key, global (not per-coach), since it's shared platform code, not a
-- per-coach custom recipe. Any coach can view/correct these; this is a
-- data-quality task, not a personalization one.
create table public.builtin_ingredient_usda_mappings (
  ingredient_key text primary key,
  usda_fdc_id integer references public.usda_foods(fdc_id) on delete set null,
  mapped_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.builtin_ingredient_usda_mappings enable row level security;
create policy "builtin_ingredient_usda_mappings_select_all" on public.builtin_ingredient_usda_mappings for select
  to authenticated using (true);
create policy "builtin_ingredient_usda_mappings_write_coach" on public.builtin_ingredient_usda_mappings for all
  to authenticated using (
    exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')
  )
  with check (
    exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach')
  );

-- Real per-coach ingredient mapping for Recipe Hub v2 custom recipes
-- (recipe_ingredients already carries protein_per_100g/carbs_per_100g/
-- fat_per_100g — this just points that ingredient at a real USDA food so
-- its exact scaled grams, already computed by lib/recipe-scaling.ts's
-- scaleRecipe(), can be multiplied out to real Key-12 micronutrient
-- values instead of macros alone).
alter table public.recipe_ingredients add column usda_fdc_id integer references public.usda_foods(fdc_id) on delete set null;

-- Standard vs. Youth/Team nutrition display mode, per group (mirrors the
-- existing groups.team_mode boolean pattern). Youth/Team mode shows a
-- protein-first hero with no calorie-deficit framing — coach-toggled,
-- defaults off so every existing group is unaffected.
alter table public.groups add column nutrition_youth_mode boolean not null default false;
