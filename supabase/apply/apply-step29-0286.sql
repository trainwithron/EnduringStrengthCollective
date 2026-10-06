-- STEP 29: 0286 favorite foods: a client can star a food they logged and log it again in one tap (extends recipe_favorites; private to the client; macros frozen as starred)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes at once. After the code deploy: in the nutrition log a client can save any logged food (or a planned meal after Ate it) as a favorite, and a Favorites row of one-tap chips shows when they log something else. Favorites are private: a coach never sees them, and starring or logging from one tells nobody anything. The old recipe hearts are untouched and are not shown as favorite foods.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recipe_favorites' and column_name = 'kind'))) then
    raise exception 'Step 29 (0286) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0286_food_favorites.sql
-- ====================================================================================================

-- A client can star a food they logged and log it again in one tap (Ron, Oct 6). It extends the existing favorites table (recipe_favorites, 0048) instead of
-- adding a second one: a favorite food is a row with kind 'food', a label, and the macros AS THEY WERE WHEN IT WAS STARRED (a frozen snapshot, so a later
-- change to anything else never alters it). The existing recipe hearts are kind 'recipe' (the default) and are not shown as favorite foods.
--
--  * Private to the client, as before: the existing policy only lets a person read and write their own rows, so a coach never sees someone's favorites.
--    Starring a food signals nothing to the coach, and logging from a favorite is an ordinary log entry.
--  * A food favorite must have a label and calories. At most 60 food favorites per client, so the list stays usable.
-- Re-runnable. Needs recipe_favorites (0048).

alter table public.recipe_favorites
  add column if not exists kind text not null default 'recipe',
  add column if not exists label text,
  add column if not exists calories numeric,
  add column if not exists protein_g numeric,
  add column if not exists carbs_g numeric,
  add column if not exists fat_g numeric;

alter table public.recipe_favorites drop constraint if exists recipe_favorites_kind_check;
alter table public.recipe_favorites add constraint recipe_favorites_kind_check check (kind in ('recipe', 'food'));

alter table public.recipe_favorites drop constraint if exists recipe_favorites_food_snapshot;
alter table public.recipe_favorites add constraint recipe_favorites_food_snapshot
  check (kind <> 'food' or (label is not null and btrim(label) <> '' and length(label) <= 200 and calories is not null and calories >= 0));

create index if not exists recipe_favorites_food_idx on public.recipe_favorites (profile_id, kind, created_at desc);

create or replace function public.limit_food_favorites()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.kind = 'food' and (select count(*) from public.recipe_favorites f where f.profile_id = new.profile_id and f.kind = 'food') >= 60 then
    raise exception 'You can keep up to 60 favorite foods. Remove one to add another.';
  end if;
  return new;
end;
$function$;

drop trigger if exists recipe_favorites_limit_food on public.recipe_favorites;
create trigger recipe_favorites_limit_food
  before insert on public.recipe_favorites
  for each row execute function public.limit_food_favorites();

commit;
