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

-- Loading the products (Spot Commander, Nov 23): one batch per call, from scripts/usda-branded-load.mjs with the server key, so 100 MB of products never has to be pasted.
-- The same rules as a batch file (scripts/usda-branded-lib.mjs toBrandedBatchSql), in one transaction: nothing when the batch's marker is already in usda_load_batches;
-- otherwise a product USDA republished under a new fdc_id replaces the old row with the same barcode, a product already there is updated in place, then the marker is written.
-- Any bad row (a value the table refuses, a wrong type) fails the whole call, so no marker and no half batch. Only the server key may call it. Returns the rows loaded (0 = the
-- batch was already loaded).
create or replace function public.load_usda_branded_batch(p_name text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count integer;
begin
  if p_name is null or p_name !~ '^branded-[a-z0-9][a-z0-9-]{1,60}$' then
    raise exception 'batch_name: must start with branded- (lower case letters, digits and dashes)';
  end if;
  if exists (select 1 from public.usda_load_batches where name = p_name) then
    return 0;
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'batch_rows: must be a JSON array of products';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 10000 then
    raise exception 'batch_rows: 1 to 10000 products a call (got %)', v_count;
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e where jsonb_typeof(e) <> 'object') then
    raise exception 'batch_rows: every product must be a JSON object';
  end if;

  delete from public.usda_branded_foods b
  using jsonb_to_recordset(p_rows) as r(fdc_id integer, gtin text)
  where r.gtin is not null and b.gtin = r.gtin and b.fdc_id <> r.fdc_id;

  insert into public.usda_branded_foods (fdc_id, gtin, brand_owner, brand_name, description, category, serving_size, serving_size_unit, household_serving,
                                         kcal, protein_g, carbs_g, fat_g, fiber_g, sugars_g, sodium_mg, published_date)
  select r.fdc_id, r.gtin, r.brand_owner, r.brand_name, r.description, r.category, r.serving_size, r.serving_size_unit, r.household_serving,
         r.kcal, r.protein_g, r.carbs_g, r.fat_g, r.fiber_g, r.sugars_g, r.sodium_mg, r.published_date
  from jsonb_to_recordset(p_rows) as r(fdc_id integer, gtin text, brand_owner text, brand_name text, description text, category text, serving_size numeric,
                                       serving_size_unit text, household_serving text, kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric,
                                       sugars_g numeric, sodium_mg numeric, published_date date)
  on conflict (fdc_id) do update set gtin = excluded.gtin, brand_owner = excluded.brand_owner, brand_name = excluded.brand_name, description = excluded.description,
    category = excluded.category, serving_size = excluded.serving_size, serving_size_unit = excluded.serving_size_unit, household_serving = excluded.household_serving,
    kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, fiber_g = excluded.fiber_g, sugars_g = excluded.sugars_g,
    sodium_mg = excluded.sodium_mg, published_date = excluded.published_date;

  insert into public.usda_load_batches (name, rows_loaded) values (p_name, v_count);
  return v_count;
end
$function$;
revoke all on function public.load_usda_branded_batch(text, jsonb) from public, anon, authenticated;
grant execute on function public.load_usda_branded_batch(text, jsonb) to service_role;
