-- STEP 45: 0300 Food search and logging: USDA household portions (public reference table), a record of which USDA batches were loaded, and the optional detail of a searched food on a food log entry (source, USDA food, grams, serving, nutrient snapshot), with sanity limits on what can be logged from now on
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for anyone until the code in the same release is live. After that: any client can search the USDA foods, pick a serving (grams, ounces, household measures once the USDA portions are loaded), see the nutrients and log it, then edit or delete the entry. Existing food logs are untouched.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.usda_food_portions') is null)
     and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'food_log_entries' and column_name = 'fdc_id'))
     and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'food_tracking_enabled'))) then
    raise exception 'Step 45 (0300) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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

commit;
