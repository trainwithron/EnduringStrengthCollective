-- A client can star a food they logged and log it again in one tap (Ron, Oct 6). It extends the existing favorites table (recipe_favorites, 0048) instead of
-- adding a second one: a favorite food is a row with kind 'food', a label, and the macros AS THEY WERE WHEN IT WAS STARRED (a frozen snapshot, so a later
-- change to anything else never alters it). The existing recipe hearts are kind 'recipe' (the default) and are not shown as favorite foods.
--
--  * Private to the client, as before: the existing policy only lets a person read and write their own rows, so a coach never sees someone's favorites.
--    Starring a food signals nothing to the coach, and logging from a favorite is an ordinary log entry.
--  * A food favorite must have a label and calories (macros never negative). At most 60 food favorites per client, so the list stays usable (also when
--    a heart is changed into a food favorite).
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
  check (kind <> 'food' or (label is not null and btrim(label) <> '' and length(label) <= 200 and calories is not null and calories >= 0
    and coalesce(protein_g, 0) >= 0 and coalesce(carbs_g, 0) >= 0 and coalesce(fat_g, 0) >= 0));

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
  before insert or update of kind on public.recipe_favorites
  for each row execute function public.limit_food_favorites();
