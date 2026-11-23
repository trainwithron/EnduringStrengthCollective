-- UNDO: step 223. Only if it must be taken back. Puts the food search back exactly as it was (migration 0300) and removes the synonyms. If no everyday (FNDDS) foods were loaded yet, the
-- name columns go and the data type rule is as before; if they were loaded, those foods and their names are KEPT (nothing is deleted) and the old search simply reads them as it
-- reads any food. Last result: one row, all true.

begin;

drop function if exists public.search_usda_foods(text[], integer);
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

drop table if exists public.food_search_synonyms;

do $undo$
begin
  if not exists (select 1 from public.usda_foods where data_type = 'Survey (FNDDS)') then
    alter table public.usda_foods drop constraint if exists usda_foods_plain_name_check;
    alter table public.usda_foods drop constraint if exists usda_foods_extra_names_check;
    alter table public.usda_foods drop column if exists plain_name, drop column if exists extra_names, drop column if exists common;
    alter table public.usda_foods drop constraint if exists usda_foods_data_type_check;
    alter table public.usda_foods add constraint usda_foods_data_type_check check (data_type in ('Foundation', 'SR Legacy'));
  end if;
end
$undo$;

commit;

-- Check: one row, all true.
select
  md5(replace((select prosrc from pg_proc where oid = 'public.search_usda_foods(text[], integer)'::regprocedure), chr(13), '')) = 'ddf683e15f560d97fa552ae06ea5b097' as search_as_before,
  position('plain_name' in (select pg_get_function_result('public.search_usda_foods(text[], integer)'::regprocedure))) = 0 as search_returns_as_before,
  has_function_privilege('authenticated', 'public.search_usda_foods(text[], integer)', 'execute') and not has_function_privilege('anon', 'public.search_usda_foods(text[], integer)', 'execute') as search_access_as_before,
  to_regclass('public.food_search_synonyms') is null as synonyms_gone,
  (exists (select 1 from public.usda_foods where data_type = 'Survey (FNDDS)'))
    or ((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'usda_foods' and column_name in ('plain_name', 'extra_names', 'common')) = 0
        and position('Survey (FNDDS)' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'usda_foods_data_type_check' and conrelid = 'public.usda_foods'::regclass)) = 0) as table_as_before_or_everyday_foods_kept;
