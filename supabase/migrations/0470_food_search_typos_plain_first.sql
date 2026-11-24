-- Step 226 (Ron, Nov 23: food search round 2, "do 1 and 2"). Re-running is safe.
--
-- 1. Forgiving spelling. Live, "chiken breast" found nothing at all. Now, when a search finds nothing (no everyday food AND no packaged food; the app decides that and asks
--    once), each word that is not a known food word is swapped for the closest known word, and the app searches again and says "Showing results for chicken breast".
--     * pg_trgm (in the extensions schema) and public.food_search_words: every word (3 to 40 letters) of the USDA foods (names, plain names, other names), the synonyms and the
--       packaged foods (brand and name), with how often it is used. Read by any signed-in person, like the foods.
--     * Kept current by triggers: each insert or update of usda_foods or usda_branded_foods adds its words (a 1,000-product batch adds about 40 ms), so the loaders need no extra
--       step. public.refresh_food_search_words() rebuilds the whole list from the tables (about 20 s live; the SQL editor only, too long for the 8 s server calls).
--     * public.correct_food_search_words(words): the words with the misspelled ones swapped. Stays as typed: a word with a digit ("2" of "2% milk") or under 3 letters; a word
--       of the everyday foods or the synonyms ("creatine", "grapes", "goose": spelled right by definition); and any word unless a close word is used at least 20 times as often
--       (a few packaged foods are misspelled themselves: "chiken" is on 3 products, "chicken" on 14,006). A word already on some products is only swapped for a word of the
--       everyday foods, never for its own singular ("whites" stays "whites"), and never for a filler word ("with", "and", "inc", ...). Close = one typing slip (a letter missing,
--       extra, wrong, or two letters swapped: food_word_distance), two for words of 8 or more letters; among those, the same first letter first ("bagle" is "bagel", not
--       "eagle"), then the word most used in the everyday foods ("brest" is "breast", not the brand "Best"), then the most used anywhere. Candidates come from the trigram
--       index (similarity 0.3 or more: 0.4 would miss "cheerois", 0.385 from "cheerios", and keep "cheers", 0.45; the slip count picks the right one).
-- 2. The plain version first. Live, "egg whites" put the egg white omelet with meat first. search_usda_foods gets one new tier ahead of the others: an everyday food named by hand
--    (common) whose own name, or its first part, is the search ("Egg whites, cooked" for "egg whites", "Tomato" for "tomato"; a plural and its singular count as the same name,
--    food_words_singular). The names and the common flag of 31 everyday foods change to match scripts/usda-fndds-lib.mjs (so a reload gives the same), and three synonyms let the
--    USDA name be found by what people type (spaghetti: pasta; maple syrup: USDA's "Syrups, maple"; protein bar: nutrition bar). No nutrition changes; no food is added.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.food_words_singular(p_words text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $function$
  select regexp_replace(regexp_replace(coalesce(p_words, ''), '\m([a-z]{2,}o)es\M', '\1', 'g'), '\m([a-z]{2,}[a-rt-z])s\M', '\1', 'g');
$function$;
revoke all on function public.food_words_singular(text) from public, anon;
grant execute on function public.food_words_singular(text) to authenticated, service_role;

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
           -- an everyday food named by hand (common) whose own name, or the first part of it, is the search: "egg whites" is "Egg whites, cooked", "tomato" is "Tomato" (a plural
           -- and its singular count as the same name). Its USDA name when it has no plain name ("Coffee, brewed" for "coffee").
           coalesce(bool_or(c.common and public.food_words_singular(v.phrase) in (public.food_words_singular(c.plain_n), public.food_words_singular(c.plain_first_n),
                                                                                   case when c.plain_n = '' then public.food_words_singular(c.desc_first_n) end)), false) as named,
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
      o.named desc,
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
    t.named desc,
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

create table if not exists public.food_search_words (
  word text primary key check (word ~ '^[a-z]{3,40}$'),
  uses integer not null default 0 check (uses >= 0),
  -- how often it is used in the everyday foods (USDA names, plain names, other names) and the synonyms: a word of these is spelled right and never swapped
  everyday integer not null default 0 check (everyday >= 0)
);
create index if not exists food_search_words_trgm_idx on public.food_search_words using gin (word extensions.gin_trgm_ops);
alter table public.food_search_words enable row level security;
drop policy if exists "food_search_words_select_all" on public.food_search_words;
create policy "food_search_words_select_all" on public.food_search_words for select to authenticated using (true);
revoke all on public.food_search_words from anon;
revoke insert, update, delete, truncate, references, trigger on public.food_search_words from authenticated;
grant select on public.food_search_words to authenticated;

-- The whole list again, from the tables. Returns the number of words.
create or replace function public.refresh_food_search_words()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count integer;
begin
  delete from public.food_search_words;
  insert into public.food_search_words (word, uses, everyday)
  select x.w, count(*)::integer, (count(*) filter (where x.everyday))::integer
  from (
    select regexp_split_to_table(lower(f.description || ' ' || coalesce(f.plain_name, '') || ' ' || coalesce(f.extra_names, '')), '[^a-z]+') as w, true as everyday from public.usda_foods f
    union all
    select regexp_split_to_table(lower(s.phrase || ' ' || s.alternative), '[^a-z]+'), true from public.food_search_synonyms s
    union all
    select regexp_split_to_table(lower(coalesce(b.brand_owner, '') || ' ' || coalesce(b.brand_name, '') || ' ' || b.description), '[^a-z]+'), false from public.usda_branded_foods b
  ) x
  where length(x.w) between 3 and 40
  group by x.w;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;
revoke all on function public.refresh_food_search_words() from public, anon, authenticated;
grant execute on function public.refresh_food_search_words() to service_role;

-- The triggers: the words of the rows just added (counted) or changed (new words only, so a monthly refresh does not double every count; a word a changed USDA food now uses
-- counts as an everyday word).
create or replace function public.food_search_words_from_foods()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.food_search_words (word, uses, everyday)
    select x.w, count(*)::integer, count(*)::integer
    from (select regexp_split_to_table(lower(n.description || ' ' || coalesce(n.plain_name, '') || ' ' || coalesce(n.extra_names, '')), '[^a-z]+') as w from new_rows n) x
    where length(x.w) between 3 and 40
    group by x.w
    on conflict (word) do update set uses = public.food_search_words.uses + excluded.uses, everyday = public.food_search_words.everyday + excluded.everyday;
  else
    insert into public.food_search_words (word, uses, everyday)
    select x.w, count(*)::integer, count(*)::integer
    from (select regexp_split_to_table(lower(n.description || ' ' || coalesce(n.plain_name, '') || ' ' || coalesce(n.extra_names, '')), '[^a-z]+') as w from new_rows n) x
    where length(x.w) between 3 and 40
    group by x.w
    on conflict (word) do update set everyday = greatest(public.food_search_words.everyday, 1);
  end if;
  return null;
end
$function$;
create or replace function public.food_search_words_from_branded()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.food_search_words (word, uses)
    select x.w, count(*)::integer
    from (select regexp_split_to_table(lower(coalesce(n.brand_owner, '') || ' ' || coalesce(n.brand_name, '') || ' ' || n.description), '[^a-z]+') as w from new_rows n) x
    where length(x.w) between 3 and 40
    group by x.w
    on conflict (word) do update set uses = public.food_search_words.uses + excluded.uses;
  else
    insert into public.food_search_words (word, uses)
    select x.w, count(*)::integer
    from (select regexp_split_to_table(lower(coalesce(n.brand_owner, '') || ' ' || coalesce(n.brand_name, '') || ' ' || n.description), '[^a-z]+') as w from new_rows n) x
    where length(x.w) between 3 and 40
    group by x.w
    on conflict (word) do nothing;
  end if;
  return null;
end
$function$;
revoke all on function public.food_search_words_from_foods() from public, anon, authenticated;
revoke all on function public.food_search_words_from_branded() from public, anon, authenticated;
drop trigger if exists usda_foods_words_added on public.usda_foods;
create trigger usda_foods_words_added after insert on public.usda_foods referencing new table as new_rows for each statement execute function public.food_search_words_from_foods();
drop trigger if exists usda_foods_words_changed on public.usda_foods;
create trigger usda_foods_words_changed after update on public.usda_foods referencing new table as new_rows for each statement execute function public.food_search_words_from_foods();
drop trigger if exists usda_branded_foods_words_added on public.usda_branded_foods;
create trigger usda_branded_foods_words_added after insert on public.usda_branded_foods referencing new table as new_rows for each statement execute function public.food_search_words_from_branded();
drop trigger if exists usda_branded_foods_words_changed on public.usda_branded_foods;
create trigger usda_branded_foods_words_changed after update on public.usda_branded_foods referencing new table as new_rows for each statement execute function public.food_search_words_from_branded();

-- How many typing slips apart two words are: a letter missing, extra or wrong, or two neighbouring letters swapped, each one slip ("cheerois" and "cheerios" are 1 apart).
create or replace function public.food_word_distance(p_a text, p_b text)
returns integer
language plpgsql
immutable
strict
parallel safe
set search_path = public
as $function$
declare
  la integer := length(p_a);
  lb integer := length(p_b);
  prev2 integer[];
  prev integer[];
  cur integer[];
  i integer;
  j integer;
  v integer;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  if la > 40 or lb > 40 then return greatest(la, lb); end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i] || array_fill(0, array[lb]);
    for j in 1..lb loop
      v := least(prev[j + 1] + 1, cur[j] + 1, prev[j] + case when substr(p_a, i, 1) = substr(p_b, j, 1) then 0 else 1 end);
      if i > 1 and j > 1 and substr(p_a, i, 1) = substr(p_b, j - 1, 1) and substr(p_a, i - 1, 1) = substr(p_b, j, 1) then
        v := least(v, prev2[j - 1] + 1);
      end if;
      cur[j + 1] := v;
    end loop;
    prev2 := prev;
    prev := cur;
  end loop;
  return prev[lb + 1];
end
$function$;
revoke all on function public.food_word_distance(text, text) from public, anon;
grant execute on function public.food_word_distance(text, text) to authenticated, service_role;

-- The search words with the misspelled ones swapped (cleaned the way the searches clean them; at most 6). Runs as the caller: it only reads the word list.
create or replace function public.correct_food_search_words(p_tokens text[])
returns text[]
language plpgsql
stable
set search_path = public, extensions
as $function$
declare
  v_tok text;
  v_out text[] := array[]::text[];
  v_own integer;
  v_own_everyday integer;
  v_word text;
  v_uses integer;
begin
  foreach v_tok in array coalesce(p_tokens, array[]::text[]) loop
    v_tok := lower(regexp_replace(coalesce(v_tok, ''), '[^a-zA-Z0-9]', '', 'g'));
    continue when v_tok = '';
    exit when cardinality(v_out) >= 6;
    if v_tok ~ '[0-9]' or length(v_tok) < 3 or length(v_tok) > 40 then
      v_out := v_out || v_tok;
      continue;
    end if;
    select coalesce(max(w.uses), 0), coalesce(max(w.everyday), 0) into v_own, v_own_everyday from public.food_search_words w where w.word = v_tok;
    -- a word of the everyday foods or the synonyms is spelled right: never swapped ("creatine", "grapes", "goose")
    if v_own_everyday > 0 then
      v_out := v_out || v_tok;
      continue;
    end if;
    v_word := null;
    select c.word, c.uses into v_word, v_uses
    from (
      select w.word, w.uses, w.everyday, similarity(w.word, v_tok) as sim
      from public.food_search_words w
      where w.word % v_tok and w.word <> v_tok
        -- never a filler word, never the word's own singular ("whites" is not a misspelled "white")
        and w.word not in ('with', 'and', 'the', 'for', 'from', 'inc', 'llc', 'nfs', 'not', 'made')
        and v_tok not in (w.word || 's', w.word || 'es')
        -- a word already on some products only gives way to a word of the everyday foods
        and (v_own = 0 or w.everyday > 0)
      order by similarity(w.word, v_tok) desc, w.everyday desc, w.uses desc, w.word
      limit 50
    ) c
    where public.food_word_distance(c.word, v_tok) <= case when length(v_tok) >= 8 then 2 else 1 end
    -- the fewest slips, then the same first letter ("bagle": bagel, not eagle), then the most used in the everyday foods ("brest": breast, not the brand Best), then anywhere
    order by public.food_word_distance(c.word, v_tok), (left(c.word, 1) = left(v_tok, 1)) desc, c.everyday desc, c.uses desc, c.sim desc, c.word
    limit 1;
    if v_word is not null and v_uses > v_own and v_uses >= v_own * 20 then
      v_out := v_out || v_word;
    else
      v_out := v_out || v_tok;
    end if;
  end loop;
  return v_out;
end
$function$;
revoke all on function public.correct_food_search_words(text[]) from public, anon;
grant execute on function public.correct_food_search_words(text[]) to authenticated, service_role;

-- The plain version first: names and the common flag as scripts/usda-fndds-lib.mjs gives them (only these rows differ from step 223's load).
update public.usda_foods f
set plain_name = v.plain_name, common = v.common
from (values
  ('Bacon, NS as to type of meat, cooked', 'Bacon, cooked', true),
  ('Cereal, granola', 'Granola', true),
  ('Cereal, ready-to-eat, NFS', 'Cereal, ready-to-eat', true),
  ('Cheese, cottage, NFS', 'Cottage cheese', true),
  ('Cheese, Mozzarella, NFS', 'Mozzarella', true),
  ('Cheese, NFS', 'Cheese', true),
  ('Chicken thigh, baked, broiled, or roasted, skin not eaten, from raw', 'Chicken thigh, cooked (no skin)', true),
  ('Chicken, NS as to part, baked, broiled, or roasted, skin not eaten', 'Chicken, roasted (no skin)', true),
  ('Coffee, brewed', null::text, true),
  ('Cream cheese, regular, plain', 'Cream cheese', true),
  ('Egg, white, cooked, no added fat', 'Egg whites, cooked', true),
  ('Fish, cod, baked or broiled', 'Cod, cooked', true),
  ('Fish, tilapia, baked or broiled', 'Tilapia, cooked', true),
  ('Fish, tuna, canned', 'Tuna, canned', true),
  ('Green peas, NS as to form, cooked', 'Peas, cooked', true),
  ('Mayonnaise, regular', 'Mayonnaise', true),
  ('Nutrition bar or meal replacement bar, NFS', 'Nutrition bar', true),
  ('Nutritional powder mix, whey based, NFS', 'Whey protein, powder', true),
  ('Onions, raw', 'Onion', true),
  ('Pasta, cooked', null::text, true),
  ('Pizza, cheese, from restaurant or fast food, NS as to type of crust', 'Pizza, cheese (restaurant)', true),
  ('Pork, chop, NS as to fat eaten', 'Pork chop', true),
  ('Potato, mashed, from fresh, made with milk', 'Mashed potatoes', true),
  ('Quinoa, no added fat', 'Quinoa, cooked', true),
  ('Sour cream, regular', 'Sour cream', true),
  ('Soybean curd', 'Tofu', true),
  ('Steak, NS as to type of meat, NS as to fat eaten', 'Steak', true),
  ('Summer squash, green, raw', 'Zucchini, raw', true),
  ('Tea, hot, leaf, black', 'Tea, black, hot', true),
  ('Tomatoes, raw', 'Tomato', true),
  ('Walnuts, excluding honey roasted', 'Walnuts', true)
) as v(description, plain_name, common)
where f.data_type = 'Survey (FNDDS)' and f.description = v.description
  and (f.plain_name is distinct from v.plain_name or f.common is distinct from v.common);

insert into public.food_search_synonyms (phrase, alternative) values
  ('spaghetti', 'pasta'),
  ('maple syrup', 'syrups maple'),
  ('protein bar', 'nutrition bar')
on conflict do nothing;

-- Last: the whole word list, from everything above, and its statistics (so the trigram index is used from the first search).
select public.refresh_food_search_words();
analyze public.food_search_words;
