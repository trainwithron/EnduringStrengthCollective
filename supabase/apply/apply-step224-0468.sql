-- PASTE: step 224 (brand-name packaged foods from USDA Branded Foods: the table the barcode lookup and the "Packaged foods" search read, and its search). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.
-- The products themselves are NOT in this paste: they are loaded afterwards, one batch per call, with node scripts/usda-branded-load.mjs (it uses load_usda_branded_batch below).

begin;

-- Brand-name packaged foods from USDA FoodData Central's Branded Foods (Ron, Nov 23: the food search rebuild, part B). Re-runnable.
--
--  * usda_branded_foods: one compact row per packaged product (the label's brand, name, barcode, serving and the nutrients the app shows, per 100 g or 100 ml as USDA publishes
--    them). Public reference data: read by any signed-in person, written only by the import batches (scripts/usda-branded-import.mjs, run on purpose by a person, never by the app).
--    gtin is the barcode with its leading zeros removed (lib/food-barcode.ts normalizeBarcode), so a UPC-A, its EAN-13 and its GTIN-14 are one value; one row per barcode.
--  * search_branded_foods(p_tokens, p_limit): the "Packaged foods" group of the food search. Every word of two or more characters must be in the brand or the name, as a whole word,
--    except the LAST, which may be the start of a word ("2% milk": milk must be there; the "2" only helps the order). Words are cleaned to letters and digits here, so nothing else can
--    reach the text search. At most 2,000 matches are ranked (a common word matches tens of thousands of products): whole-word matches and the shortest names. Best first: the
--    name holding the whole phrase (at its start first), then the short words ("2") as words of the name, whole words before a prefix, then the shorter name, then text rank.
--    At most 50 rows come back.
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
grant select on public.usda_branded_foods to authenticated;

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
  -- the words the text search needs: two or more characters (a lone "2" or "a" matches far too much); the last of them may be the start of a word
  words as (select c.t, c.n from clean c where length(c.t) > 1),
  q as (
    select to_tsquery('simple'::regconfig, string_agg(case when w.n = (select max(x.n) from words x) then w.t || ':*' else w.t end, ' & ' order by w.n)) as query,
           -- the same words, all whole: "milk" itself before "milkshake"
           to_tsquery('simple'::regconfig, string_agg(w.t, ' & ' order by w.n)) as whole
    from words w
  ),
  -- every word as typed (the short ones too: the "2" of "2% milk"), for "the name holds the whole phrase" and "the name has the short word"
  phrase as (select ' ' || string_agg(c.t, ' ' order by c.n) || ' ' as p from clean c),
  shorts as (select c.t from clean c where length(c.t) = 1),
  -- The matches to rank: at most 2,000, whole-word matches first, then the shortest names (the plain products: "2% MILK" before a long candy name). Only the cheap
  -- checks run over every match; the ranking below runs over these.
  hits as (
    select b.*
    from public.usda_branded_foods b, q
    where exists (select 1 from words)
      and b.search @@ q.query
    order by (b.search @@ q.whole) desc, length(b.description) asc
    limit 2000
  ),
  scored as (
    select h.*, ' ' || regexp_replace(lower(h.description), '[^a-z0-9]+', ' ', 'g') || ' ' as plain
    from hits h
  )
  select s.fdc_id, s.gtin, s.brand_owner, s.brand_name, s.description, s.category, s.serving_size, s.serving_size_unit, s.household_serving,
         s.kcal, s.protein_g, s.carbs_g, s.fat_g, s.fiber_g, s.sugars_g, s.sodium_mg
  from scored s, q, phrase
  order by
    (position(phrase.p in s.plain) > 0) desc,
    (position(phrase.p in s.plain) = 1) desc,
    (select count(*) from shorts x where position(' ' || x.t || ' ' in s.plain) > 0) desc,
    (s.search @@ q.whole) desc,
    -- a short name is the plain product ("WHOLE MILK"); the text rank only breaks ties (it favours a name that repeats the words)
    length(s.description) asc,
    ts_rank(s.search, q.query, 1) desc,
    s.published_date desc nulls last,
    s.fdc_id asc
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

commit;

-- Check: one row, all true.
select
  to_regclass('public.usda_branded_foods') is not null as branded_table,
  (select relrowsecurity from pg_class where oid = 'public.usda_branded_foods'::regclass) as row_security_on,
  exists (select 1 from pg_policy where polrelid = 'public.usda_branded_foods'::regclass and polname = 'usda_branded_foods_select_all' and polcmd = 'r') as signed_in_can_read,
  has_table_privilege('authenticated', 'public.usda_branded_foods', 'select') as signed_in_has_select,
  not has_table_privilege('anon', 'public.usda_branded_foods', 'select') as anon_cannot_read,
  not has_table_privilege('authenticated', 'public.usda_branded_foods', 'insert') as signed_in_cannot_write,
  to_regclass('public.usda_branded_foods_gtin_key') is not null as barcode_index,
  to_regclass('public.usda_branded_foods_search_idx') is not null as search_index,
  to_regprocedure('public.search_branded_foods(text[], integer)') is not null as search_function,
  has_function_privilege('authenticated', 'public.search_branded_foods(text[], integer)', 'execute') as signed_in_can_search,
  not has_function_privilege('anon', 'public.search_branded_foods(text[], integer)', 'execute') as anon_cannot_search,
  to_regprocedure('public.load_usda_branded_batch(text, jsonb)') is not null as load_function,
  (select prosecdef from pg_proc where oid = 'public.load_usda_branded_batch(text, jsonb)'::regprocedure) as load_runs_as_owner,
  (select coalesce(proconfig, array[]::text[]) @> array['search_path=public'] from pg_proc where oid = 'public.load_usda_branded_batch(text, jsonb)'::regprocedure) as load_search_path_set,
  has_function_privilege('service_role', 'public.load_usda_branded_batch(text, jsonb)', 'execute') as server_key_can_load,
  not has_function_privilege('anon', 'public.load_usda_branded_batch(text, jsonb)', 'execute') as anon_cannot_load,
  not has_function_privilege('authenticated', 'public.load_usda_branded_batch(text, jsonb)', 'execute') as signed_in_cannot_load;
