-- UNDO: step 226. Only if it must be taken back: the search as step 225 left it, the 31 names and flags back, the 3 synonyms and the word list gone, pg_trgm removed. Last result:
-- one row, all true.

begin;

drop trigger if exists usda_foods_words_added on public.usda_foods;
drop trigger if exists usda_foods_words_changed on public.usda_foods;
drop trigger if exists usda_branded_foods_words_added on public.usda_branded_foods;
drop trigger if exists usda_branded_foods_words_changed on public.usda_branded_foods;
drop function if exists public.food_search_words_from_foods();
drop function if exists public.food_search_words_from_branded();
drop function if exists public.refresh_food_search_words();
drop function if exists public.correct_food_search_words(text[]);
drop function if exists public.food_word_distance(text, text);
drop table if exists public.food_search_words;

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

drop function if exists public.food_words_singular(text);

update public.usda_foods f
set plain_name = v.plain_name, common = v.common
from (values
  ('Bacon, NS as to type of meat, cooked', null::text, false),
  ('Cereal, granola', 'Granola cereal', false),
  ('Cereal, ready-to-eat, NFS', null::text, false),
  ('Cheese, cottage, NFS', null::text, false),
  ('Cheese, Mozzarella, NFS', null::text, false),
  ('Cheese, NFS', null::text, false),
  ('Chicken thigh, baked, broiled, or roasted, skin not eaten, from raw', null::text, false),
  ('Chicken, NS as to part, baked, broiled, or roasted, skin not eaten', null::text, false),
  ('Coffee, brewed', 'Brewed coffee', false),
  ('Cream cheese, regular, plain', null::text, false),
  ('Egg, white, cooked, no added fat', null::text, false),
  ('Fish, cod, baked or broiled', null::text, false),
  ('Fish, tilapia, baked or broiled', null::text, false),
  ('Fish, tuna, canned', 'Canned tuna', true),
  ('Green peas, NS as to form, cooked', null::text, false),
  ('Mayonnaise, regular', 'Regular mayonnaise', false),
  ('Nutrition bar or meal replacement bar, NFS', null::text, false),
  ('Nutritional powder mix, whey based, NFS', null::text, false),
  ('Onions, raw', 'Onions', false),
  ('Pasta, cooked', 'Cooked pasta', false),
  ('Pizza, cheese, from restaurant or fast food, NS as to type of crust', null::text, false),
  ('Pork, chop, NS as to fat eaten', null::text, false),
  ('Potato, mashed, from fresh, made with milk', null::text, false),
  ('Quinoa, no added fat', null::text, false),
  ('Sour cream, regular', 'Regular sour cream', false),
  ('Soybean curd', null::text, false),
  ('Steak, NS as to type of meat, NS as to fat eaten', null::text, false),
  ('Summer squash, green, raw', null::text, false),
  ('Tea, hot, leaf, black', null::text, false),
  ('Tomatoes, raw', 'Tomatoes', false),
  ('Walnuts, excluding honey roasted', 'Excluding honey roasted walnuts', false)
) as v(description, plain_name, common)
where f.data_type = 'Survey (FNDDS)' and f.description = v.description;

delete from public.food_search_synonyms where (phrase, alternative) in (('spaghetti', 'pasta'), ('maple syrup', 'syrups maple'), ('protein bar', 'nutrition bar'));

drop extension if exists pg_trgm;

commit;

-- Check: one row, all true.
select
  md5(replace((select prosrc from pg_proc where oid = 'public.search_usda_foods(text[], integer)'::regprocedure), chr(13), '')) = 'e3ad35e6b129ca09d07c778a931c7fbc' as search_as_step_225_left_it,
  to_regclass('public.food_search_words') is null and to_regprocedure('public.correct_food_search_words(text[])') is null as word_list_gone,
  not exists (select 1 from pg_extension where extname = 'pg_trgm') as trigram_search_removed,
  (select count(*) from public.food_search_synonyms) = 8 as synonyms_as_before,
  has_function_privilege('authenticated', 'public.search_usda_foods(text[], integer)'::regprocedure, 'execute') and not has_function_privilege('anon', 'public.search_usda_foods(text[], integer)'::regprocedure, 'execute') as same_access;
