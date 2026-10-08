-- Custom foods and saved meals (nutrition tracking, phase 2). A client can add a food that is not in the USDA data (a protein bar, a restaurant dish, a family recipe) with the numbers
-- from its label, and save a meal made of several foods to log again in one tap.
--
--  * custom_foods: one row per food a client created. Numbers are PER SERVING (as printed on a label): calories, protein, carbs, fat, plus an optional full label (fibre, sugar,
--    saturated fat, sodium, and so on) in a small jsonb. A barcode may be attached; one barcode per client. Private to the client and readable by their coaches; only the client
--    writes. Sane limits are enforced here as well as in the app.
--  * saved_meals and saved_meal_items: a named meal and its foods, each item holding the amount and the numbers for it as saved. Same access: the client's own, readable by
--    their coaches.
-- Nothing here changes any existing table. Re-runnable.

-- A label or a food's nutrient snapshot is a small object of numbers: every value must be a number between 0 and the given maximum, so nothing that reads these later (the daily
-- totals, the nutrient pages) has to defend against text or negatives. Immutable, so it can sit in a check.
create or replace function public.nutrients_are_numbers(j jsonb, max_value numeric)
returns boolean
language sql
immutable
set search_path = public
as $function$
  select case
    when j is null then true
    when jsonb_typeof(j) <> 'object' then false
    else not exists (
      select 1 from jsonb_each(j) e
      where case when jsonb_typeof(e.value) = 'number' then not ((e.value #>> '{}')::numeric between 0 and max_value) else true end
    )
  end;
$function$;
-- NOTE: leave execute open (the default). It is used inside check constraints, and a row written by a signed-in person is refused with "permission denied for function" if
-- they cannot execute it (the rehearsal proves this). It is a pure function of its two arguments and reads nothing.

create table if not exists public.custom_foods (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  brand text check (brand is null or char_length(brand) <= 80),
  serving_label text not null check (char_length(btrim(serving_label)) between 1 and 80),
  serving_g numeric check (serving_g is null or (serving_g > 0 and serving_g <= 5000)),
  calories numeric not null check (calories >= 0 and calories <= 6000),
  protein_g numeric not null default 0 check (protein_g >= 0 and protein_g <= 500),
  carbs_g numeric not null default 0 check (carbs_g >= 0 and carbs_g <= 1000),
  fat_g numeric not null default 0 check (fat_g >= 0 and fat_g <= 500),
  nutrients jsonb check (nutrients is null or (jsonb_typeof(nutrients) = 'object' and pg_column_size(nutrients) <= 6000 and public.nutrients_are_numbers(nutrients, 1000000))),
  barcode text check (barcode is null or char_length(barcode) <= 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists custom_foods_athlete_idx on public.custom_foods (athlete_id, created_at desc);
create unique index if not exists custom_foods_athlete_barcode_uniq on public.custom_foods (athlete_id, barcode) where barcode is not null;

alter table public.custom_foods enable row level security;
drop policy if exists "custom_foods_select_own_or_coach" on public.custom_foods;
create policy "custom_foods_select_own_or_coach" on public.custom_foods for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_coach_of_athlete(athlete_id));
drop policy if exists "custom_foods_write_own" on public.custom_foods;
create policy "custom_foods_write_own" on public.custom_foods for all to authenticated
  using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));
revoke all on public.custom_foods from anon;
revoke truncate, references, trigger on public.custom_foods from authenticated;

create table if not exists public.saved_meals (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_meals_athlete_idx on public.saved_meals (athlete_id, created_at desc);

create table if not exists public.saved_meal_items (
  id uuid primary key default uuid_generate_v4(),
  meal_id uuid not null references public.saved_meals(id) on delete cascade,
  position integer not null default 0 check (position >= 0 and position < 200),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  serving_label text check (serving_label is null or char_length(serving_label) <= 120),
  serving_qty numeric check (serving_qty is null or (serving_qty > 0 and serving_qty <= 10000)),
  amount_g numeric check (amount_g is null or (amount_g > 0 and amount_g <= 20000)),
  calories numeric not null check (calories >= 0 and calories <= 20000),
  protein_g numeric not null default 0 check (protein_g >= 0 and protein_g <= 2000),
  carbs_g numeric not null default 0 check (carbs_g >= 0 and carbs_g <= 5000),
  fat_g numeric not null default 0 check (fat_g >= 0 and fat_g <= 2000),
  nutrients jsonb check (nutrients is null or (jsonb_typeof(nutrients) = 'object' and pg_column_size(nutrients) <= 12000 and public.nutrients_are_numbers(nutrients, 1000000))),
  food_source text check (food_source is null or food_source in ('usda', 'custom', 'saved_meal', 'barcode', 'ai', 'plan')),
  fdc_id integer references public.usda_foods(fdc_id) on delete set null
);
create index if not exists saved_meal_items_meal_idx on public.saved_meal_items (meal_id, position);

alter table public.saved_meals enable row level security;
drop policy if exists "saved_meals_select_own_or_coach" on public.saved_meals;
create policy "saved_meals_select_own_or_coach" on public.saved_meals for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_coach_of_athlete(athlete_id));
drop policy if exists "saved_meals_write_own" on public.saved_meals;
create policy "saved_meals_write_own" on public.saved_meals for all to authenticated
  using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));
revoke all on public.saved_meals from anon;
revoke truncate, references, trigger on public.saved_meals from authenticated;

alter table public.saved_meal_items enable row level security;
drop policy if exists "saved_meal_items_select_own_or_coach" on public.saved_meal_items;
create policy "saved_meal_items_select_own_or_coach" on public.saved_meal_items for select to authenticated
  using (exists (select 1 from public.saved_meals m where m.id = saved_meal_items.meal_id and (m.athlete_id = (select auth.uid()) or public.is_coach_of_athlete(m.athlete_id))));
drop policy if exists "saved_meal_items_write_own" on public.saved_meal_items;
create policy "saved_meal_items_write_own" on public.saved_meal_items for all to authenticated
  using (exists (select 1 from public.saved_meals m where m.id = saved_meal_items.meal_id and m.athlete_id = (select auth.uid())))
  with check (exists (select 1 from public.saved_meals m where m.id = saved_meal_items.meal_id and m.athlete_id = (select auth.uid())));
revoke all on public.saved_meal_items from anon;
revoke truncate, references, trigger on public.saved_meal_items from authenticated;

-- A client cannot pile up rows without end: 1,000 custom foods, 300 saved meals, 60 foods in one meal (far more than anyone uses). Checked on insert, with the server key too.
create or replace function public.guard_food_library_limits()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_count integer;
begin
  if tg_table_name = 'custom_foods' then
    select count(*) into v_count from public.custom_foods where athlete_id = new.athlete_id;
    if v_count >= 1000 then raise exception 'You have reached the limit of 1,000 custom foods. Delete some you no longer use.'; end if;
  elsif tg_table_name = 'saved_meals' then
    select count(*) into v_count from public.saved_meals where athlete_id = new.athlete_id;
    if v_count >= 300 then raise exception 'You have reached the limit of 300 saved meals. Delete some you no longer use.'; end if;
  elsif tg_table_name = 'saved_meal_items' then
    select count(*) into v_count from public.saved_meal_items where meal_id = new.meal_id;
    if v_count >= 60 then raise exception 'A saved meal can have up to 60 foods.'; end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_food_library_limits() from public, anon, authenticated;

drop trigger if exists custom_foods_limit on public.custom_foods;
create trigger custom_foods_limit before insert on public.custom_foods for each row execute function public.guard_food_library_limits();
drop trigger if exists saved_meals_limit on public.saved_meals;
create trigger saved_meals_limit before insert on public.saved_meals for each row execute function public.guard_food_library_limits();
drop trigger if exists saved_meal_items_limit on public.saved_meal_items;
create trigger saved_meal_items_limit before insert on public.saved_meal_items for each row execute function public.guard_food_library_limits();

-- updated_at is kept by the database, not the app: any change stamps it.
create or replace function public.food_library_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
revoke all on function public.food_library_touch_updated_at() from public, anon, authenticated;

drop trigger if exists custom_foods_touch on public.custom_foods;
create trigger custom_foods_touch before update on public.custom_foods for each row execute function public.food_library_touch_updated_at();
drop trigger if exists saved_meals_touch on public.saved_meals;
create trigger saved_meals_touch before update on public.saved_meals for each row execute function public.food_library_touch_updated_at();
