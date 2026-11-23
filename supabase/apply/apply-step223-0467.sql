-- PASTE: step 223 (the food search: USDA's everyday foods, plain names, a few synonyms, and a search that puts the food you mean first). Paste all of it into the Supabase SQL
-- editor and run. Last result: one row, all true. The everyday foods themselves are loaded AFTER this, in batches (scripts/usda-import.mjs), by Spot Commander.

begin;

-- Step 223 (Ron, Nov 23: "type whole milk and get whole milk; 2% milk gives exactly 2% milk; sourdough bread gives sourdough bread"). The food search gets USDA's everyday foods (FNDDS,
-- the foods people actually report eating, with plain names like "Milk, whole") and a search that puts the food the person means first. Re-running is safe.
--
--  1. usda_foods may hold 'Survey (FNDDS)' foods (loaded afterwards by scripts/usda-import.mjs, in batches, like the Foundation and SR Legacy foods), with:
--       plain_name  the name a person says ("Whole milk"), shown big above USDA's own name; null when it would only repeat the USDA name;
--       extra_names USDA's "additional descriptions" for the food (other names it goes by), searched but not shown;
--       common      one of the everyday foods given a plain name by hand: first among equally good matches.
--  2. food_search_synonyms: a few words people type that USDA writes another way ("sourdough" is "sour dough", "skim" is "fat free"). A query that holds the words is also tried with
--     the other wording. Read by any signed-in person, written only here (or by a later step).
--  3. search_usda_foods, same arguments, one more column (plain_name). The best first: the plain name (or the first part of USDA's name) is exactly the search, then names that start with
--     it, then the hand-named everyday foods, then the everyday foods (FNDDS), the Foundation foods, the SR Legacy foods; then the old order (the words in the first part of the name,
--     the second part, shorter names). One row per name: the same USDA name twice shows once (the FNDDS one if there is one, then Foundation, then SR Legacy).
--     The coach's food picker and recipe matching read the tables directly and keep every food.

-- 1. The everyday foods.
alter table public.usda_foods drop constraint if exists usda_foods_data_type_check;
alter table public.usda_foods add constraint usda_foods_data_type_check check (data_type in ('Foundation', 'SR Legacy', 'Survey (FNDDS)'));
alter table public.usda_foods
  add column if not exists plain_name text,
  add column if not exists extra_names text,
  add column if not exists common boolean not null default false;
do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'usda_foods_plain_name_check' and conrelid = 'public.usda_foods'::regclass) then
    alter table public.usda_foods add constraint usda_foods_plain_name_check check (plain_name is null or char_length(plain_name) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'usda_foods_extra_names_check' and conrelid = 'public.usda_foods'::regclass) then
    alter table public.usda_foods add constraint usda_foods_extra_names_check check (extra_names is null or char_length(extra_names) <= 4000);
  end if;
end
$checks$;

-- 2. Words people type that USDA writes another way. Both sides are lower-case words separated by single spaces (the way the search cleans a query).
create table if not exists public.food_search_synonyms (
  phrase text not null check (phrase ~ '^[a-z0-9]+( [a-z0-9]+){0,3}$'),
  alternative text not null check (alternative ~ '^[a-z0-9]+( [a-z0-9]+){0,5}$' and alternative <> phrase),
  primary key (phrase, alternative)
);
alter table public.food_search_synonyms enable row level security;
drop policy if exists "food_search_synonyms_select_all" on public.food_search_synonyms;
create policy "food_search_synonyms_select_all" on public.food_search_synonyms for select to authenticated using (true);
revoke all on public.food_search_synonyms from anon;
grant select on public.food_search_synonyms to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.food_search_synonyms from authenticated;
insert into public.food_search_synonyms (phrase, alternative) values
  ('2', 'reduced fat 2'),
  ('1', 'low fat 1'),
  ('skim', 'fat free'),
  ('nonfat', 'fat free'),
  ('non fat', 'fat free'),
  ('sourdough', 'sour dough'),
  ('french bread', 'bread french vienna'),
  ('whole milk', 'milk whole')
on conflict do nothing;

-- 3. The search. The same arguments as before (migration 0300), so the app calls it the same way; plain_name is added at the end, so the return type changes and the old one is dropped first.
drop function if exists public.search_usda_foods(text[], integer);
create function public.search_usda_foods(p_tokens text[], p_limit integer default 60)
returns table(fdc_id integer, description text, data_type text, food_category text, kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, plain_name text)
language sql
stable
set search_path = public
as $function$
  with raw as (
    select lower(regexp_replace(u.t, '[^a-zA-Z0-9]', '', 'g')) as t, u.n
    from unnest(coalesce(p_tokens, array[]::text[])) with ordinality as u(t, n)
  ),
  clean as (select r.t, r.n from raw r where r.t <> '' order by r.n limit 6),
  q as (select string_agg(c.t, ' ' order by c.n) as phrase, (select c2.t from clean c2 order by c2.n limit 1) as first_tok from clean c),
  -- the query itself, and the query with a synonym's words swapped for its other wording (whole words only)
  variants as (
    select q.phrase from q where q.phrase is not null
    union
    select trim(replace(' ' || q.phrase || ' ', ' ' || s.phrase || ' ', ' ' || s.alternative || ' '))
    from q join public.food_search_synonyms s on position(' ' || s.phrase || ' ' in ' ' || q.phrase || ' ') > 0
  ),
  candidates as (
    select f.fdc_id, f.description, f.data_type, f.food_category, f.plain_name, f.common,
           trim(regexp_replace(lower(coalesce(f.plain_name, '')), '[^a-z0-9]+', ' ', 'g')) as plain_n,
           trim(regexp_replace(lower(split_part(coalesce(f.plain_name, ''), ',', 1)), '[^a-z0-9]+', ' ', 'g')) as plain_first_n,
           trim(regexp_replace(lower(f.description), '[^a-z0-9]+', ' ', 'g')) as desc_n,
           trim(regexp_replace(lower(split_part(f.description, ',', 1)), '[^a-z0-9]+', ' ', 'g')) as desc_first_n,
           lower(f.description || ' ' || coalesce(f.plain_name, '') || ' ' || coalesce(f.extra_names, '')) as hay
    from public.usda_foods f
  ),
  matched as (
    select c.*,
           bool_or(v.phrase in (c.plain_n, c.plain_first_n, c.desc_n, c.desc_first_n)) as exact,
           bool_or((c.plain_n <> '' and (c.plain_n = v.phrase or c.plain_n like v.phrase || ' %')) or c.desc_n = v.phrase or c.desc_n like v.phrase || ' %') as starts,
           max((select count(*) from unnest(string_to_array(v.phrase, ' ')) w where position(w in split_part(lower(c.description), ',', 1)) > 0)) as first_words,
           max((select count(*) from unnest(string_to_array(v.phrase, ' ')) w where position(w in split_part(lower(c.description), ',', 2)) > 0)) as second_words
    from candidates c
    join variants v on not exists (select 1 from unnest(string_to_array(v.phrase, ' ')) w where position(w in c.hay) = 0)
    group by c.fdc_id, c.description, c.data_type, c.food_category, c.plain_name, c.common, c.plain_n, c.plain_first_n, c.desc_n, c.desc_first_n, c.hay
  ),
  -- one row per USDA name: the everyday (FNDDS) one first, then Foundation, then SR Legacy
  one_per_name as (
    select distinct on (lower(m.description)) m.*,
           case m.data_type when 'Survey (FNDDS)' then 0 when 'Foundation' then 1 else 2 end as type_rank
    from matched m
    order by lower(m.description), case m.data_type when 'Survey (FNDDS)' then 0 when 'Foundation' then 1 else 2 end, m.fdc_id
  ),
  top as (
    select o.* from one_per_name o
    order by
      o.exact desc,
      o.starts desc,
      o.common desc,
      o.type_rank asc,
      (lower(o.description) like (select q.first_tok from q) || '%') desc,
      o.first_words desc,
      o.second_words desc,
      length(o.description) asc,
      o.fdc_id asc
    limit least(greatest(coalesce(p_limit, 60), 1), 100)
  )
  select t.fdc_id, t.description, t.data_type, t.food_category,
         (select n.amount_per_100g from public.usda_food_nutrients n where n.fdc_id = t.fdc_id and n.nutrient_key = 'kcal'),
         (select n.amount_per_100g from public.usda_food_nutrients n where n.fdc_id = t.fdc_id and n.nutrient_key = 'protein_g'),
         (select n.amount_per_100g from public.usda_food_nutrients n where n.fdc_id = t.fdc_id and n.nutrient_key = 'carbs_g'),
         (select n.amount_per_100g from public.usda_food_nutrients n where n.fdc_id = t.fdc_id and n.nutrient_key = 'fat_g'),
         t.plain_name
  from top t
  order by
    t.exact desc,
    t.starts desc,
    t.common desc,
    t.type_rank asc,
    (lower(t.description) like (select q.first_tok from q) || '%') desc,
    t.first_words desc,
    t.second_words desc,
    length(t.description) asc,
    t.fdc_id asc;
$function$;
revoke all on function public.search_usda_foods(text[], integer) from public, anon;
grant execute on function public.search_usda_foods(text[], integer) to authenticated, service_role;

commit;

-- Check: one row, all true.
select
  position('Survey (FNDDS)' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'usda_foods_data_type_check' and conrelid = 'public.usda_foods'::regclass)) > 0 as everyday_foods_allowed,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'usda_foods' and column_name in ('plain_name', 'extra_names', 'common')) = 3 as name_columns_added,
  (select count(*) from public.food_search_synonyms) >= 8 as synonyms_in,
  (select relrowsecurity from pg_class where oid = 'public.food_search_synonyms'::regclass) as synonyms_row_security_on,
  not has_table_privilege('authenticated', 'public.food_search_synonyms', 'insert') as synonyms_read_only_for_signed_in,
  position('plain_name text' in (select pg_get_function_result('public.search_usda_foods(text[], integer)'::regprocedure))) > 0 as search_returns_plain_name,
  has_function_privilege('authenticated', 'public.search_usda_foods(text[], integer)', 'execute') as signed_in_can_search,
  not has_function_privilege('anon', 'public.search_usda_foods(text[], integer)', 'execute') as signed_out_cannot_search,
  (select count(*) from public.search_usda_foods(array['milk'], 5)) <= 5 as search_runs;
