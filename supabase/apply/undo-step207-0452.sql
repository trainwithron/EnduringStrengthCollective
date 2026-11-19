-- UNDO: step 207 (starred meals). Removes the starred meals and the meal column, and puts the favorites rules back as they were (0286). The coach recipes were never changed.

begin;

delete from public.recipe_favorites where kind = 'meal';
alter table public.recipe_favorites drop constraint if exists recipe_favorites_meal_snapshot;
alter table public.recipe_favorites drop constraint if exists recipe_favorites_kind_check;
alter table public.recipe_favorites add constraint recipe_favorites_kind_check check (kind in ('recipe', 'food'));
alter table public.recipe_favorites drop column if exists meal;

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

commit;
