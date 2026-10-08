-- RELEASE N (NUTRITION TRACKING: FOOD SEARCH, CUSTOM FOODS, NUTRIENT DETAIL): ONE paste. Steps 45, 46, 47, 48 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 45: Nothing changes for anyone until the code in the same release is live. After that: any client can search the USDA foods, pick a serving (grams, ounces, household measures once the USDA portions are loaded), see the nutrients and log it, then edit or delete the entry. Existing food logs are untouched.
-- AFTER STEP 46: Nothing changes for anyone until the code in the same release is live. After that: each organization (a solo coach, or a gym's trainers together) has one monthly AI budget measured in real cost; the app tells the owner and the coach plainly at about 80 percent and when it is used up, and pauses AI features until the 1st, unless a paid top-up (when payments are on) adds to that month. Food search, barcode and saved meals are never limited. A top-up that is refunded in Stripe does NOT take its dollars back out of the budget; remove that row from ai_budget_topups by hand if a refund is ever given.
-- AFTER STEP 47: Nothing changes for anyone until the code in the same release is live. After that: a client can add a food that is not in the USDA data (a bar, a restaurant dish, a family recipe), scan a barcode that is not found and create it, and save a meal to log again in one tap. Their coach can see these.
-- AFTER STEP 48: Clients can no longer see what any client pays. The code that is live today still finds the old rate column (now empty) and carries on; the Business estimate shows nothing until the code in the same release is live, then shows the same rates as before. Step 49 (after the deploy) removes the old column.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release N (nutrition tracking: food search, custom foods, nutrient detail), step 45: 0300 Food search and logging: USDA household portions (public reference table), a record of which USDA batches were loaded, and the optional detail of a searched food on a food log entry (source, USDA food, grams, serving, nutrient snapshot), with sanity limits on what can be logged from now on
do $g45$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('food_log_entries and usda_foods exist', to_regclass('public.food_log_entries') is not null and to_regclass('public.usda_foods') is not null),
      ('0300 is not already applied (usda_food_portions is not there yet)', to_regclass('public.usda_food_portions') is null),
      ('0300 is not already applied (food_log_entries has no fdc_id yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'food_log_entries' and column_name = 'fdc_id')),
      ('0300 is not already applied (group_memberships has no food_tracking_enabled yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'food_tracking_enabled'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release N (nutrition tracking: food search, custom foods, nutrient detail), step 45 (0300) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g45$;

-- ====================================================================================================
-- migration 0300_food_search_logging.sql
-- ====================================================================================================

-- Food search and logging (nutrition tracking, phase 1). Every client can search the USDA foods already in the database, pick a serving, see the nutrients and log it.
--
--  * usda_food_portions: the household measures USDA publishes for a food ("1 cup, chopped" = 140 g), as public reference data. Read by any signed-in person, written only by the
--    import script (the server key); empty until that import runs, and the app works without it (grams and ounces are always offered).
--  * usda_load_batches: one row per import batch that was loaded in full (the import writes a batch and its marker in one transaction), so an interrupted load is resumable and
--    a half-loaded batch can never be mistaken for a finished one.
--  * food_log_entries gets the optional detail of a searched food: where it came from, the USDA food, the grams logged, the serving as shown ("1 cup, chopped" x 1.5), and a
--    snapshot of the nutrients for the amount logged (a missing key means "not reported", never zero). Existing rows and every existing way of logging are untouched.
--  * Sanity limits on what can be logged from now on (new rows only; existing rows are not rechecked).
--  * group_memberships.food_tracking_enabled (default true): a coach can turn food tracking off for a client who does not track. The client's Nutrition page then says so and
--    offers no logging; nothing already logged is removed. Written by the coach the same way as the other per-client switches on a membership.
-- Nothing here changes who can read or write a food log: a client writes only their own, their group's coach reads it (0162). Re-runnable.

-- Nullable on purpose (null counts as on): a bulk restore of memberships from a backup file fills columns it does not know with null, and a NOT NULL here would break it.
alter table public.group_memberships add column if not exists food_tracking_enabled boolean default true;

create table if not exists public.usda_food_portions (
  id bigint generated always as identity primary key,
  fdc_id integer not null references public.usda_foods(fdc_id) on delete cascade,
  seq integer not null,
  description text not null check (char_length(description) between 1 and 200),
  gram_weight numeric not null check (gram_weight > 0 and gram_weight < 100000),
  unique (fdc_id, seq)
);
create index if not exists usda_food_portions_fdc_idx on public.usda_food_portions (fdc_id);

alter table public.usda_food_portions enable row level security;
drop policy if exists "usda_food_portions_select_all" on public.usda_food_portions;
create policy "usda_food_portions_select_all" on public.usda_food_portions for select to authenticated using (true);
revoke all on public.usda_food_portions from anon;
revoke insert, update, delete, truncate, references, trigger on public.usda_food_portions from authenticated;

create table if not exists public.usda_load_batches (
  name text primary key,
  rows_loaded integer not null check (rows_loaded >= 0),
  loaded_at timestamptz not null default now()
);
alter table public.usda_load_batches enable row level security;
drop policy if exists "usda_load_batches_select_all" on public.usda_load_batches;
create policy "usda_load_batches_select_all" on public.usda_load_batches for select to authenticated using (true);
revoke all on public.usda_load_batches from anon;
revoke insert, update, delete, truncate, references, trigger on public.usda_load_batches from authenticated;

alter table public.food_log_entries
  add column if not exists food_source text,
  add column if not exists fdc_id integer references public.usda_foods(fdc_id) on delete set null,
  add column if not exists amount_g numeric,
  add column if not exists serving_label text,
  add column if not exists serving_qty numeric,
  add column if not exists nutrients jsonb,
  add column if not exists barcode text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'food_log_entries_food_source_check') then
    alter table public.food_log_entries add constraint food_log_entries_food_source_check
      check (food_source is null or food_source in ('usda', 'custom', 'saved_meal', 'barcode', 'ai', 'plan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'food_log_entries_detail_check') then
    alter table public.food_log_entries add constraint food_log_entries_detail_check
      check (
        (amount_g is null or (amount_g > 0 and amount_g <= 20000))
        and (serving_qty is null or (serving_qty > 0 and serving_qty <= 10000))
        and (serving_label is null or char_length(serving_label) <= 120)
        and (barcode is null or char_length(barcode) <= 32)
        and (nutrients is null or (jsonb_typeof(nutrients) = 'object' and pg_column_size(nutrients) <= 12000))
      );
  end if;
  -- Sane amounts for anything logged from now on. NOT VALID: new and edited rows are checked, rows already in the table are left alone.
  if not exists (select 1 from pg_constraint where conname = 'food_log_entries_amounts_sane') then
    alter table public.food_log_entries add constraint food_log_entries_amounts_sane
      check (
        (calories is null or (calories >= 0 and calories <= 20000))
        and (protein_g is null or (protein_g >= 0 and protein_g <= 2000))
        and (carbs_g is null or (carbs_g >= 0 and carbs_g <= 5000))
        and (fat_g is null or (fat_g >= 0 and fat_g <= 2000))
      ) not valid;
  end if;
end $$;

-- Food search, ranked in the database. A common word ("beef", "chicken", "oil") matches hundreds of the ~8,200 USDA foods, so the best matches have to be picked by the database,
-- not from whatever rows happen to come back first. The words must ALL be in the name; the best come first: a name that is exactly the search, then names that start with the first
-- word, then the most words in the first part of the name (USDA names put the food first: "Chicken, broilers or fryers, breast, ..."), then the second part, then the more carefully
-- measured Foundation foods, then shorter names. Returns the four macros per 100 g with each food. Words are cleaned to letters and digits here too, so a wildcard can never reach
-- the pattern. A normal signed-in function (USDA data is readable by any signed-in person); at most 100 rows.
create or replace function public.search_usda_foods(p_tokens text[], p_limit integer default 60)
returns table(fdc_id integer, description text, data_type text, food_category text, kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric)
language sql
stable
set search_path = public
as $function$
  with raw as (
    select lower(regexp_replace(u.t, '[^a-zA-Z0-9]', '', 'g')) as t, u.n
    from unnest(coalesce(p_tokens, array[]::text[])) with ordinality as u(t, n)
  ),
  clean as (select r.t, r.n from raw r where r.t <> '' order by r.n limit 6),
  first_tok as (select c.t from clean c order by c.n limit 1),
  phrase as (select string_agg(c.t, ' ' order by c.n) as p from clean c)
  select f.fdc_id, f.description, f.data_type, f.food_category,
         (select n.amount_per_100g from public.usda_food_nutrients n where n.fdc_id = f.fdc_id and n.nutrient_key = 'kcal'),
         (select n.amount_per_100g from public.usda_food_nutrients n where n.fdc_id = f.fdc_id and n.nutrient_key = 'protein_g'),
         (select n.amount_per_100g from public.usda_food_nutrients n where n.fdc_id = f.fdc_id and n.nutrient_key = 'carbs_g'),
         (select n.amount_per_100g from public.usda_food_nutrients n where n.fdc_id = f.fdc_id and n.nutrient_key = 'fat_g')
  from public.usda_foods f
  where exists (select 1 from clean)
    and not exists (select 1 from clean c where position(c.t in lower(f.description)) = 0)
  order by
    (split_part(lower(f.description), ',', 1) = (select p from phrase)) desc,
    (lower(f.description) like (select t from first_tok) || '%') desc,
    (select count(*) from clean c where position(c.t in split_part(lower(f.description), ',', 1)) > 0) desc,
    (select count(*) from clean c where position(c.t in split_part(lower(f.description), ',', 2)) > 0) desc,
    (f.data_type = 'Foundation') desc,
    length(f.description) asc,
    f.fdc_id asc
  limit least(greatest(coalesce(p_limit, 60), 1), 100);
$function$;
revoke all on function public.search_usda_foods(text[], integer) from public, anon;
grant execute on function public.search_usda_foods(text[], integer) to authenticated, service_role;

-- ===== Release N (nutrition tracking: food search, custom foods, nutrient detail), step 46: 0301 AI budget: one pool per organization (its size, and this month's AI use summed by model, both server-only), paid top-up packs added to a month's budget, and a record that the owner and coach were told the AI is running low or used up, once per month
do $g46$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('ai_usage_log exists', to_regclass('public.ai_usage_log') is not null),
      ('organizations, organization_billing, organization_memberships and coach_credits exist (the budget reads them)', to_regclass('public.organizations') is not null and to_regclass('public.organization_billing') is not null and to_regclass('public.organization_memberships') is not null and to_regclass('public.coach_credits') is not null),
      ('0301 is not already applied (ai_org_summary is not there yet)', not exists (select 1 from pg_proc where proname = 'ai_org_summary' and pronamespace = 'public'::regnamespace)),
      ('0301 is not already applied (ai_budget_notices is not there yet)', to_regclass('public.ai_budget_notices') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release N (nutrition tracking: food search, custom foods, nutrient detail), step 46 (0301) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g46$;

-- ====================================================================================================
-- migration 0301_ai_budget.sql
-- ====================================================================================================

-- AI budget (nutrition tracking, phase 1). One monthly AI budget per ORGANIZATION (a solo coach's organization is just them), measured in real cost: every AI call is already logged
-- with its model and token counts (ai_usage_log, 0226); the app prices those tokens and compares the month's total with the organization's budget. A gym with several trainers
-- shares one pool. This migration adds the pieces the database has to hold. All of them are server-only: the usage log and the budget helpers are not readable from the app.
--
--  * ai_org_summary(org): how big the organization is for the budget: its client count, how many coaches it has, whether it is free-access (beta) and its own scale, and whether its
--    owner is an internal unlimited account.
--  * ai_org_month_usage(org, since): this month's AI use for every coach in the organization, summed by model (input tokens, output tokens, calls), counting only calls that
--    finished (ok, or cut off after producing output); a failed call is never counted. Priced in the app (lib/ai-budget.ts), so a price change never needs a database change.
--  * ai_budget_topups: money added to an organization's budget for one month by a paid top-up pack (written by the payment webhook, once per payment).
--  * ai_budget_notices: one row per organization, month and level ('low' = about 80 percent, 'out' = used up) so the owner and the coach are told ONCE, not on every request.
-- Nothing here changes who can read or write anything else. Re-runnable.

create or replace function public.ai_org_summary(p_org_id uuid)
returns table(clients integer, coaches integer, billing_exempt boolean, ai_scale numeric, owner_unlimited boolean)
language sql
stable
security definer
set search_path = public
as $function$
  select
    (select count(distinct a.profile_id)::integer
       from public.group_memberships a
       join public.groups g on g.id = a.group_id
      where g.organization_id = p_org_id and a.role = 'athlete' and a.membership_type = 'training'),
    greatest(1, (select count(distinct c.profile_id)::integer
       from public.group_memberships c
       join public.groups g on g.id = c.group_id
      where g.organization_id = p_org_id and c.role = 'coach')),
    coalesce((select ob.billing_exempt from public.organization_billing ob where ob.organization_id = p_org_id), false),
    (select ob.ai_allowance_scale from public.organization_billing ob where ob.organization_id = p_org_id),
    coalesce((select cc.ai_access_mode = 'unlimited'
                from public.organizations o
                join public.coach_credits cc on cc.coach_id = o.owner_id
               where o.id = p_org_id), false);
$function$;
revoke all on function public.ai_org_summary(uuid) from public, anon, authenticated;
grant execute on function public.ai_org_summary(uuid) to service_role;

create or replace function public.ai_org_month_usage(p_org_id uuid, p_since timestamptz default null)
returns table(model text, input_tokens bigint, output_tokens bigint, calls bigint)
language sql
stable
security definer
set search_path = public
as $function$
  select l.model,
         coalesce(sum(l.input_tokens), 0)::bigint,
         coalesce(sum(l.output_tokens), 0)::bigint,
         count(*)::bigint
  from public.ai_usage_log l
  where l.coach_id in (select om.profile_id from public.organization_memberships om where om.organization_id = p_org_id)
    and l.created_at >= coalesce(p_since, (date_trunc('month', now() at time zone 'utc')) at time zone 'utc')
    and l.status in ('ok', 'truncated')
  group by l.model;
$function$;
revoke all on function public.ai_org_month_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_org_month_usage(uuid, timestamptz) to service_role;

create table if not exists public.ai_budget_topups (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  usd_added numeric not null check (usd_added > 0 and usd_added <= 1000),
  pack_cents integer not null check (pack_cents > 0),
  stripe_event_id text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists ai_budget_topups_org_month_idx on public.ai_budget_topups (organization_id, month);
alter table public.ai_budget_topups enable row level security;
-- No policy at all: only the server (service role, from the payment webhook) writes or reads it.
revoke all on public.ai_budget_topups from anon, authenticated;

create table if not exists public.ai_budget_notices (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  level text not null check (level in ('low', 'out')),
  created_at timestamptz not null default now(),
  primary key (organization_id, month, level)
);
alter table public.ai_budget_notices enable row level security;
revoke all on public.ai_budget_notices from anon, authenticated;

-- ===== Release N (nutrition tracking: food search, custom foods, nutrient detail), step 47: 0302 Custom foods and saved meals: a client's own foods (with the numbers from a label, an optional full label and a barcode) and meals saved from several foods, private to the client and readable by their coaches, with limits on how many
do $g47$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('profiles, usda_foods and is_coach_of_athlete exist', to_regclass('public.profiles') is not null and to_regclass('public.usda_foods') is not null and exists (select 1 from pg_proc where proname = 'is_coach_of_athlete' and pronamespace = 'public'::regnamespace)),
      ('0302 is not already applied (custom_foods is not there yet)', to_regclass('public.custom_foods') is null),
      ('0302 is not already applied (saved_meals is not there yet)', to_regclass('public.saved_meals') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release N (nutrition tracking: food search, custom foods, nutrient detail), step 47 (0302) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g47$;

-- ====================================================================================================
-- migration 0302_custom_foods_saved_meals.sql
-- ====================================================================================================

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

-- ===== Release N (nutrition tracking: food search, custom foods, nutrient detail), step 48: 0303 What a client pays becomes coach-only (part one): the coach's manual monthly rate moves off the roster table (which every member of a group could read) into its own table that only the group's coaches can read or write (the organization's owner and admins can read it); the existing rates are copied across and the old column is emptied, so the leak is closed at once
do $g48$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('group_memberships, groups, is_group_coach and is_org_admin_of_group exist', to_regclass('public.group_memberships') is not null and to_regclass('public.groups') is not null and exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'is_org_admin_of_group' and pronamespace = 'public'::regnamespace)),
      ('0303 is not already applied (client_billing_rates is not there yet)', to_regclass('public.client_billing_rates') is null),
      ('the old rate column is still on group_memberships', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release N (nutrition tracking: food search, custom foods, nutrient detail), step 48 (0303) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g48$;

-- ====================================================================================================
-- migration 0303_client_rates_coach_only.sql
-- ====================================================================================================

-- What a client pays (the coach's manual "$/mo" estimate) must be seen by the coach only. It lived on group_memberships.monthly_rate (0045), and the roster policy
-- memberships_select_same_group lets EVERY member of a group read EVERY column of every membership row in it, so any client could read what each other client pays.
-- A row policy cannot hide one column, so the rate moves to its own table that only the group's coaches can read or write.
--
--  * client_billing_rates: one row per membership that has a rate. Coaches of the group read and write it; the organization's owner and admins may read it (the Revenue splits
--    total adds it up across the organization); nobody else (not the client, not another client) can see it at all.
-- This is part ONE of two: it creates the table, copies the rates across and EMPTIES the old column (so the leak is closed at once). The old column itself is dropped by 0304 after
-- the code that reads the new table is live; until then the code that is live today still reads the column, finds it empty, and carries on (the Business estimate shows nothing
-- for those minutes, nothing else is affected). Re-runnable: the copy and the emptying only run while the old column exists.

create table if not exists public.client_billing_rates (
  membership_id uuid primary key references public.group_memberships(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  monthly_rate numeric not null check (monthly_rate >= 0 and monthly_rate <= 100000),
  updated_at timestamptz not null default now()
);
create index if not exists client_billing_rates_group_idx on public.client_billing_rates (group_id);

alter table public.client_billing_rates enable row level security;
revoke all on public.client_billing_rates from anon;
revoke truncate, references, trigger on public.client_billing_rates from authenticated;

drop policy if exists "client_billing_rates_coach_all" on public.client_billing_rates;
create policy "client_billing_rates_coach_all" on public.client_billing_rates for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (
    public.is_group_coach(group_id)
    and exists (select 1 from public.group_memberships gm where gm.id = membership_id and gm.group_id = client_billing_rates.group_id and gm.profile_id = client_billing_rates.profile_id)
  );

-- The organization's owner and admins may READ the rates of every group in the organization; they cannot write them.
drop policy if exists "client_billing_rates_org_admin_select" on public.client_billing_rates;
create policy "client_billing_rates_org_admin_select" on public.client_billing_rates for select
  to authenticated
  using (public.is_org_admin_of_group(group_id));

do $copy$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'monthly_rate') then
    -- an amount above 100,000 is not a real rate (the old column allowed any number): it is neither carried over nor kept
    insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate)
    select gm.id, gm.group_id, gm.profile_id, gm.monthly_rate
    from public.group_memberships gm
    where gm.monthly_rate is not null and gm.monthly_rate <= 100000
    on conflict (membership_id) do nothing;
    update public.group_memberships set monthly_rate = null where monthly_rate is not null;
  end if;
end
$copy$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 45 (0300)' as step, '0300 Food search and logging: USDA household portions' as what, not ((to_regclass('public.usda_food_portions') is null) and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'food_log_entries' and column_name = 'fdc_id')) and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'food_tracking_enabled'))) as in_place
  union all
  select 'step 46 (0301)' as step, '0301 AI budget: one pool per organization' as what, not ((not exists (select 1 from pg_proc where proname = 'ai_org_summary' and pronamespace = 'public'::regnamespace)) and (to_regclass('public.ai_budget_notices') is null)) as in_place
  union all
  select 'step 47 (0302)' as step, '0302 Custom foods and saved meals: a client''s own foods' as what, not ((to_regclass('public.custom_foods') is null) and (to_regclass('public.saved_meals') is null)) as in_place
  union all
  select 'step 48 (0303)' as step, '0303 What a client pays becomes coach-only' as what, not ((to_regclass('public.client_billing_rates') is null)) as in_place
) as result order by step;
