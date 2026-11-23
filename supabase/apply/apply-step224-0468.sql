-- PASTE: step 224 (brand-name packaged foods from USDA Branded Foods: the table the barcode lookup and the "Packaged foods" search read, and its search). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.
-- The products themselves are NOT in this paste: they are loaded afterwards by the import batches (scripts/usda-branded-import.mjs), run separately.

begin;

-- Brand-name packaged foods from USDA FoodData Central's Branded Foods (Ron, Nov 23: the food search rebuild, part B). Re-runnable.
--
--  * usda_branded_foods: one compact row per packaged product (the label's brand, name, barcode, serving and the nutrients the app shows, per 100 g or 100 ml as USDA publishes
--    them). Public reference data: read by any signed-in person, written only by the import batches (scripts/usda-branded-import.mjs, run on purpose by a person, never by the app).
--    gtin is the barcode with its leading zeros removed (lib/food-barcode.ts normalizeBarcode), so a UPC-A, its EAN-13 and its GTIN-14 are one value; one row per barcode.
--  * search_branded_foods(p_tokens, p_limit): the "Packaged foods" group of the food search. Every word must be in the brand or the name (whole words, the last one may be the start
--    of a word); best matches first. Words are cleaned to letters and digits here, so nothing else can reach the text search. At most 50 rows.
-- A packaged food is logged the way a scanned one is (food_source 'barcode', its barcode in the barcode column), so nothing about food_log_entries changes here.

create table if not exists public.usda_branded_foods (
  fdc_id integer primary key,
  gtin text check (gtin is null or gtin ~ '^[0-9]{1,14}$'),
  brand_owner text check (brand_owner is null or char_length(brand_owner) <= 200),
  brand_name text check (brand_name is null or char_length(brand_name) <= 200),
  description text not null check (char_length(description) between 1 and 300),
  category text check (category is null or char_length(category) <= 120),
  serving_size numeric check (serving_size is null or (serving_size > 0 and serving_size < 100000)),
  -- 'g' or 'ml' (USDA's GRM / MLT and the like, read once by the import); null when the label gives neither
  serving_size_unit text check (serving_size_unit is null or serving_size_unit in ('g', 'ml')),
  household_serving text check (household_serving is null or char_length(household_serving) <= 120),
  kcal numeric not null check (kcal >= 0 and kcal <= 1000),
  protein_g numeric check (protein_g is null or (protein_g >= 0 and protein_g <= 200)),
  carbs_g numeric check (carbs_g is null or (carbs_g >= 0 and carbs_g <= 200)),
  fat_g numeric check (fat_g is null or (fat_g >= 0 and fat_g <= 200)),
  fiber_g numeric check (fiber_g is null or (fiber_g >= 0 and fiber_g <= 200)),
  sugars_g numeric check (sugars_g is null or (sugars_g >= 0 and sugars_g <= 200)),
  sodium_mg numeric check (sodium_mg is null or (sodium_mg >= 0 and sodium_mg <= 100000)),
  published_date date,
  search tsvector generated always as (to_tsvector('simple'::regconfig, coalesce(brand_owner, '') || ' ' || coalesce(brand_name, '') || ' ' || description)) stored,
  check (protein_g is not null or carbs_g is not null or fat_g is not null)
);
create unique index if not exists usda_branded_foods_gtin_key on public.usda_branded_foods (gtin) where gtin is not null;
create index if not exists usda_branded_foods_search_idx on public.usda_branded_foods using gin (search);

alter table public.usda_branded_foods enable row level security;
drop policy if exists "usda_branded_foods_select_all" on public.usda_branded_foods;
create policy "usda_branded_foods_select_all" on public.usda_branded_foods for select to authenticated using (true);
revoke all on public.usda_branded_foods from anon;
revoke insert, update, delete, truncate, references, trigger on public.usda_branded_foods from authenticated;

create or replace function public.search_branded_foods(p_tokens text[], p_limit integer default 10)
returns table(fdc_id integer, gtin text, brand_owner text, brand_name text, description text, category text, serving_size numeric, serving_size_unit text, household_serving text,
              kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sugars_g numeric, sodium_mg numeric)
language sql
stable
set search_path = public
as $function$
  with raw as (
    select lower(regexp_replace(u.t, '[^a-zA-Z0-9]', '', 'g')) as t, u.n
    from unnest(coalesce(p_tokens, array[]::text[])) with ordinality as u(t, n)
  ),
  clean as (select r.t, r.n from raw r where r.t <> '' order by r.n limit 6),
  q as (
    select to_tsquery('simple'::regconfig, string_agg(c.t || ':*', ' & ' order by c.n)) as query,
           string_agg(c.t, ' ' order by c.n) as phrase
    from clean c
  )
  select b.fdc_id, b.gtin, b.brand_owner, b.brand_name, b.description, b.category, b.serving_size, b.serving_size_unit, b.household_serving,
         b.kcal, b.protein_g, b.carbs_g, b.fat_g, b.fiber_g, b.sugars_g, b.sodium_mg
  from public.usda_branded_foods b, q
  where exists (select 1 from clean)
    and b.search @@ q.query
  order by
    (position(q.phrase in lower(b.description)) > 0) desc,
    ts_rank(b.search, q.query, 1) desc,
    length(b.description) asc,
    b.published_date desc nulls last,
    b.fdc_id asc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$function$;
revoke all on function public.search_branded_foods(text[], integer) from public, anon;
grant execute on function public.search_branded_foods(text[], integer) to authenticated, service_role;

commit;

-- Check: one row, all true.
select
  to_regclass('public.usda_branded_foods') is not null as branded_table,
  (select relrowsecurity from pg_class where oid = 'public.usda_branded_foods'::regclass) as row_security_on,
  exists (select 1 from pg_policy where polrelid = 'public.usda_branded_foods'::regclass and polname = 'usda_branded_foods_select_all' and polcmd = 'r') as signed_in_can_read,
  not has_table_privilege('anon', 'public.usda_branded_foods', 'select') as anon_cannot_read,
  not has_table_privilege('authenticated', 'public.usda_branded_foods', 'insert') as signed_in_cannot_write,
  to_regclass('public.usda_branded_foods_gtin_key') is not null as barcode_index,
  to_regclass('public.usda_branded_foods_search_idx') is not null as search_index,
  to_regprocedure('public.search_branded_foods(text[], integer)') is not null as search_function,
  not has_function_privilege('anon', 'public.search_branded_foods(text[], integer)', 'execute') as anon_cannot_search;
