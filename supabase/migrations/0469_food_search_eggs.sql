-- Step 225 (live check of step 223, Nov 23: "eggs" put the Foundation "Eggs, Grade A, Large, egg yolk" first, above the everyday boiled egg). The search also tries a plural without
-- its "s" ("egg" for "eggs"), but the tier "the name starts with the first word" only looked at the word as typed, so "Eggs, ..." lab rows won there before the everyday foods' turn.
-- That tier now takes the first word of any form of the query: "Egg, whole, boiled" and "Eggs, Grade A" tie on it, and the everyday food (FNDDS) wins on data type, the hand-named
-- boiled egg first among them. Only search_usda_foods changes (same arguments, same columns, same access); everything else of step 223 is untouched. Re-running is safe.
create or replace function public.search_usda_foods(p_tokens text[], p_limit integer default 60)
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
  -- the query itself, the query with a synonym's words swapped for its other wording (whole words only), and the query with a plural "s" dropped from its longer words ("eggs" finds
  -- "Egg, whole, boiled": a word is matched anywhere in the name, so the shorter form also still finds the plural)
  variants as (
    select q.phrase from q where q.phrase is not null
    union
    select trim(replace(' ' || q.phrase || ' ', ' ' || s.phrase || ' ', ' ' || s.alternative || ' '))
    from q join public.food_search_synonyms s on position(' ' || s.phrase || ' ' in ' ' || q.phrase || ' ') > 0
    union
    select (select string_agg(case when length(u.w) > 3 and u.w like '%s' and u.w not like '%ss' then left(u.w, length(u.w) - 1) else u.w end, ' ' order by u.o)
            from unnest(string_to_array(q.phrase, ' ')) with ordinality as u(w, o))
    from q where q.phrase is not null
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
           -- the name starts with the first word of the query or of one of its other forms ("egg" for "eggs": an everyday "Egg, whole, boiled" is as good a start as "Eggs, Grade A")
           bool_or(lower(c.description) like split_part(v.phrase, ' ', 1) || '%') as first_starts,
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
      o.first_starts desc,
      o.type_rank asc,
      o.first_words desc,
      o.second_words desc,
      o.common desc,
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
    t.first_starts desc,
    t.type_rank asc,
    t.first_words desc,
    t.second_words desc,
    t.common desc,
    length(t.description) asc,
    t.fdc_id asc;
$function$;
revoke all on function public.search_usda_foods(text[], integer) from public, anon;
grant execute on function public.search_usda_foods(text[], integer) to authenticated, service_role;
