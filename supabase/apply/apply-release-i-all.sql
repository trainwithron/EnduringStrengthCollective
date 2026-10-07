-- RELEASE I (FOOD PREFERENCES): ONE paste. Steps 39 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 39: Nothing changes for anyone until the code in the same release is live. After that: a client sees 'My food preferences' on their Nutrition tab and a coach sees Preferences in the client's Nutrition area; a meal option that names an allergen or a food the client does not eat is never offered and is hidden from the client if it was assigned before; a change to allergies or dislikes sends the client's coaches one short notice, and a change to a client's allergies or intolerances by someone else sends the client one. No existing data changes and no existing function is replaced. Run it together with the release's code deploy.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release I (food preferences), step 39: 0294 food preferences and allergy safety: one preferences row per client (allergies, dislikes, diet type, protein target and floor) that the client edits for their tastes and a coach edits for the rules, a fixed-wording notice to the coaches when allergies or dislikes change, the client's answer to 'are you happy with your meal plan', and three new notification types added to the list the database already has
do $g39$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('profiles, groups, group_memberships and notifications exist', to_regclass('public.profiles') is not null and to_regclass('public.groups') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.notifications') is not null),
      ('is_coach_of_athlete and is_group_coach exist (the new row security uses them)', to_regprocedure('public.is_coach_of_athlete(uuid)') is not null and exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace)),
      ('the notification types list exists and can be read (notifications_type_check)', exists (select 1 from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass)),
      ('0294 is not already applied (client_nutrition_preferences is not there yet)', to_regclass('public.client_nutrition_preferences') is null),
      ('0294 is not already applied (client_nutrition_feedback is not there yet)', to_regclass('public.client_nutrition_feedback') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release I (food preferences), step 39 (0294) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g39$;

-- ====================================================================================================
-- migration 0294_client_nutrition_preferences.sql
-- ====================================================================================================

-- Nutrition Phase 3: what a client likes, dislikes and cannot eat, and the numbers rules the coach sets for protein, in ONE place per client.
--
--  * client_nutrition_preferences: ONE row per CLIENT (the key is athlete_id alone, not a group), because a client can be in two groups (a one-on-one space with
--    one coach and a team with another) and allergies are safety data every coach of that client must see. Row security is at the athlete level, exactly like
--    athlete_profile_details: the client themself, or a coach of any group the client is an athlete in (is_coach_of_athlete, the live function). Nobody can delete it.
--  * A client may edit their TASTES (likes, dislikes, allergies, intolerances, meals per day, snack, variety, notes). The rules that shape the numbers (diet type,
--    protein target, protein success floor, carb split) belong to the coach: a trigger keeps a client's own change to them from sticking, so the browser cannot
--    work around the screen. updated_by and updated_at come from the caller, never from what was sent.
--  * Protein has a TARGET (default 1.0 g per pound) and a SUCCESS FLOOR (default 0.8 g per pound); the floor can never be above the target.
--  * A change to allergies, dislikes or intolerances tells the client's coaches with FIXED wording ("Sam changed their food preferences"), never the free text,
--    and never twice in an hour while the first is still unread. When SOMEONE ELSE changes the client's allergies or intolerances, the client is told too (fixed wording).
--  * client_nutrition_feedback: the client's answer to "are you happy with your meal plan?" after a new target (the screens come with the recalculation release,
--    the table is here so that release needs no database change). One answer per REAL target change (the date must be a date a target actually took effect for them), at most five a day; the client can only add, the coach can only mark it handled.
--  * Notification types: the three new types are added to the list the database ALREADY has (read at apply time, never typed from an older migration), so this and any
--    other release that widens the same list can apply in either order without dropping the other's types.
-- New objects only (no existing function is replaced). Re-runnable.

-- ---- small pure checks used by the table's constraints ----
create or replace function public.nutrition_list_ok(p_items text[], p_max_items int, p_max_len int)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select p_items is not null
    and coalesce(cardinality(p_items), 0) <= p_max_items
    and not exists (select 1 from unnest(p_items) x where x is null or btrim(x) = '' or char_length(x) > p_max_len);
$function$;

-- An allergy is one of the controlled list, or free text that starts with "other: ".
create or replace function public.nutrition_allergies_ok(p_items text[])
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select public.nutrition_list_ok(p_items, 20, 60)
    and not exists (
      select 1 from unnest(p_items) x
      where lower(x) not in ('peanut', 'tree nut', 'dairy', 'egg', 'soy', 'wheat or gluten', 'fish', 'shellfish', 'sesame')
        and lower(x) not like 'other: %'
    );
$function$;

create table if not exists public.client_nutrition_preferences (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  likes text[] not null default '{}',
  dislikes text[] not null default '{}',
  allergies text[] not null default '{}',
  intolerances text[] not null default '{}',
  diet_type text not null default 'omnivore',
  meals_per_day smallint not null default 3,
  include_snack boolean not null default false,
  variety text not null default 'few_favorites',
  protein_g_per_lb numeric(3, 2) not null default 1.00,
  protein_floor_g_per_lb numeric(3, 2) not null default 0.80,
  carb_split text not null default 'balanced',
  notes text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint cnp_likes_ok check (public.nutrition_list_ok(likes, 40, 60)),
  constraint cnp_dislikes_ok check (public.nutrition_list_ok(dislikes, 40, 60)),
  constraint cnp_intolerances_ok check (public.nutrition_list_ok(intolerances, 20, 60)),
  constraint cnp_allergies_ok check (public.nutrition_allergies_ok(allergies)),
  constraint cnp_diet_type_ok check (diet_type in ('omnivore', 'vegetarian', 'vegan', 'pescatarian', 'carnivore', 'keto', 'paleo')),
  constraint cnp_meals_ok check (meals_per_day between 2 and 6),
  constraint cnp_variety_ok check (variety in ('mix_it_up', 'few_favorites', 'same_most_days')),
  constraint cnp_protein_target_ok check (protein_g_per_lb between 0.60 and 1.50),
  constraint cnp_protein_floor_ok check (protein_floor_g_per_lb between 0.40 and 1.50),
  constraint cnp_floor_not_above_target check (protein_floor_g_per_lb <= protein_g_per_lb),
  constraint cnp_carb_split_ok check (carb_split in ('high', 'balanced', 'low')),
  constraint cnp_notes_ok check (char_length(notes) <= 500)
);

alter table public.client_nutrition_preferences enable row level security;

drop policy if exists "client_nutrition_preferences_select" on public.client_nutrition_preferences;
create policy "client_nutrition_preferences_select" on public.client_nutrition_preferences for select
  to authenticated
  using (athlete_id = (select auth.uid()) or public.is_coach_of_athlete(athlete_id));

drop policy if exists "client_nutrition_preferences_insert" on public.client_nutrition_preferences;
create policy "client_nutrition_preferences_insert" on public.client_nutrition_preferences for insert
  to authenticated
  with check (athlete_id = (select auth.uid()) or public.is_coach_of_athlete(athlete_id));

drop policy if exists "client_nutrition_preferences_update" on public.client_nutrition_preferences;
create policy "client_nutrition_preferences_update" on public.client_nutrition_preferences for update
  to authenticated
  using (athlete_id = (select auth.uid()) or public.is_coach_of_athlete(athlete_id))
  with check (athlete_id = (select auth.uid()) or public.is_coach_of_athlete(athlete_id));
-- No delete policy: preferences are never removed by an end user.

create or replace function public.guard_client_nutrition_preferences()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  -- The server (service role) and the SQL editor are not an end user.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- Whose preferences these are never changes.
    new.athlete_id := old.athlete_id;
  end if;
  new.updated_by := v_uid;
  new.updated_at := now();
  -- The client changing their own: tastes only. The rules that shape the numbers stay as the coach left them (or the defaults, on a first save).
  if v_uid is not null and v_uid = new.athlete_id and not coalesce(public.is_coach_of_athlete(new.athlete_id), false) then
    if tg_op = 'INSERT' then
      new.diet_type := 'omnivore';
      new.protein_g_per_lb := 1.00;
      new.protein_floor_g_per_lb := 0.80;
      new.carb_split := 'balanced';
    else
      new.diet_type := old.diet_type;
      new.protein_g_per_lb := old.protein_g_per_lb;
      new.protein_floor_g_per_lb := old.protein_floor_g_per_lb;
      new.carb_split := old.carb_split;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists client_nutrition_preferences_guard on public.client_nutrition_preferences;
create trigger client_nutrition_preferences_guard
  before insert or update on public.client_nutrition_preferences
  for each row execute function public.guard_client_nutrition_preferences();

-- ---- feedback after a new target ----
create table if not exists public.client_nutrition_feedback (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  target_effective_from date not null,
  happy boolean not null,
  change_text text not null default '',
  requests_text text not null default '',
  boring boolean not null default false,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  constraint cnf_change_text_ok check (char_length(change_text) <= 500),
  constraint cnf_requests_text_ok check (char_length(requests_text) <= 500),
  constraint cnf_status_ok check (status in ('new', 'handled'))
);
create unique index if not exists client_nutrition_feedback_one_per_change
  on public.client_nutrition_feedback (athlete_id, target_effective_from);
create index if not exists client_nutrition_feedback_group_idx on public.client_nutrition_feedback (group_id, status);

alter table public.client_nutrition_feedback enable row level security;

drop policy if exists "client_nutrition_feedback_select" on public.client_nutrition_feedback;
create policy "client_nutrition_feedback_select" on public.client_nutrition_feedback for select
  to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

-- A client adds an answer for themself, into a group they are a client in, as a new, unhandled answer.
drop policy if exists "client_nutrition_feedback_insert_client" on public.client_nutrition_feedback;
create policy "client_nutrition_feedback_insert_client" on public.client_nutrition_feedback for insert
  to authenticated
  with check (
    athlete_id = (select auth.uid())
    and status = 'new'
    and handled_by is null
    and handled_at is null
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_nutrition_feedback.group_id and gm.profile_id = client_nutrition_feedback.athlete_id and gm.role = 'athlete'
    )
    -- The date must be one a target really took effect for this client, so a client cannot invent dates to send their coaches notices.
    and exists (
      select 1 from public.client_macro_target_history h
      where h.athlete_id = client_nutrition_feedback.athlete_id and h.group_id = client_nutrition_feedback.group_id and h.effective_from = client_nutrition_feedback.target_effective_from
    )
  );

-- A coach of the group marks an answer handled (the trigger below allows nothing else to change).
drop policy if exists "client_nutrition_feedback_update_coach" on public.client_nutrition_feedback;
create policy "client_nutrition_feedback_update_coach" on public.client_nutrition_feedback for update
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));
-- No delete policy.

create or replace function public.guard_client_nutrition_feedback()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Never a flood: at most five answers a day per client (counted here, because a policy cannot count rows of its own table).
  if tg_op = 'INSERT' then
    if (select count(*) from public.client_nutrition_feedback f where f.athlete_id = new.athlete_id and f.created_at > now() - interval '1 day') >= 5 then
      raise exception 'You have sent the most answers allowed in a day. Try again tomorrow.';
    end if;
    return new;
  end if;
  -- The answer itself never changes; only whether it has been handled, by whom, and when (taken from the caller, never from what was sent).
  new.athlete_id := old.athlete_id;
  new.group_id := old.group_id;
  new.target_effective_from := old.target_effective_from;
  new.happy := old.happy;
  new.change_text := old.change_text;
  new.requests_text := old.requests_text;
  new.boring := old.boring;
  new.created_at := old.created_at;
  if new.status = 'handled' and old.status <> 'handled' then
    new.handled_by := auth.uid();
    new.handled_at := now();
  else
    new.handled_by := old.handled_by;
    new.handled_at := old.handled_at;
    new.status := old.status;
  end if;
  return new;
end;
$function$;

drop trigger if exists client_nutrition_feedback_guard on public.client_nutrition_feedback;
create trigger client_nutrition_feedback_guard
  before insert or update on public.client_nutrition_feedback
  for each row execute function public.guard_client_nutrition_feedback();

-- ---- notification types: the live list plus the three new ones ----
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  -- Every quoted value in the live list, whatever characters it has (a type with a digit or a capital is not dropped).
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['nutrition_preferences_changed', 'nutrition_prompt_answered', 'nutrition_allergies_updated']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  -- The rebuilt list must hold EVERY type the old one did, plus the new ones. If the count is off, stop and put everything back (the whole paste rolls back).
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

-- ---- fixed-wording notices to the coaches ----
create or replace function public.notify_on_nutrition_preferences()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_changed boolean;
  v_path text;
  v_rules_changed boolean;
  v_client_group uuid;
  v_client_path text;
  c record;
begin
  if tg_op = 'INSERT' then
    v_changed := coalesce(cardinality(new.allergies), 0) > 0 or coalesce(cardinality(new.dislikes), 0) > 0 or coalesce(cardinality(new.intolerances), 0) > 0;
  else
    v_changed := new.allergies is distinct from old.allergies or new.dislikes is distinct from old.dislikes or new.intolerances is distinct from old.intolerances;
  end if;
  if not v_changed then
    return new;
  end if;
  -- Someone other than the client changed their allergy or intolerance list: the client is told too, with fixed wording (removing "peanut" makes peanut meals appear again).
  if tg_op = 'INSERT' then
    v_rules_changed := coalesce(cardinality(new.allergies), 0) > 0 or coalesce(cardinality(new.intolerances), 0) > 0;
  else
    v_rules_changed := new.allergies is distinct from old.allergies or new.intolerances is distinct from old.intolerances;
  end if;
  if v_rules_changed and v_actor is not null and v_actor <> new.athlete_id then
    select gm.group_id into v_client_group
    from public.group_memberships gm
    where gm.profile_id = new.athlete_id and gm.role = 'athlete'
    order by exists (select 1 from public.group_memberships cg where cg.group_id = gm.group_id and cg.profile_id = v_actor and cg.role = 'coach') desc, gm.group_id
    limit 1;
    if v_client_group is not null then
      v_client_path := '/groups/' || v_client_group::text || '/nutrition';
      if not exists (
        select 1 from public.notifications n
        where n.profile_id = new.athlete_id and n.type = 'nutrition_allergies_updated' and n.read_at is null and n.created_at > now() - interval '1 hour'
      ) then
        insert into public.notifications (profile_id, group_id, type, body, link_path)
        values (new.athlete_id, v_client_group, 'nutrition_allergies_updated', 'Your coach updated your allergy and food list. Check it is right.', v_client_path);
      end if;
    end if;
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'Your client') into v_name from public.profiles where id = new.athlete_id;
  for c in
    select distinct gm.profile_id, gm.group_id
    from public.group_memberships gm
    join public.group_memberships a on a.group_id = gm.group_id and a.profile_id = new.athlete_id and a.role = 'athlete'
    where gm.role = 'coach' and gm.profile_id is distinct from v_actor
  loop
    v_path := '/groups/' || c.group_id::text || '/nutrition?athleteId=' || new.athlete_id::text;
    if not exists (
      select 1 from public.notifications n
      where n.profile_id = c.profile_id and n.type = 'nutrition_preferences_changed' and n.link_path = v_path
        and n.read_at is null and n.created_at > now() - interval '1 hour'
    ) then
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (c.profile_id, c.group_id, 'nutrition_preferences_changed', v_name || ' changed their food preferences', v_path);
    end if;
  end loop;
  return new;
end;
$function$;

drop trigger if exists client_nutrition_preferences_notify on public.client_nutrition_preferences;
create trigger client_nutrition_preferences_notify
  after insert or update on public.client_nutrition_preferences
  for each row execute function public.notify_on_nutrition_preferences();

create or replace function public.notify_on_nutrition_feedback()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
  c record;
begin
  select coalesce(nullif(btrim(full_name), ''), 'Your client') into v_name from public.profiles where id = new.athlete_id;
  for c in select profile_id from public.group_memberships where group_id = new.group_id and role = 'coach' loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (c.profile_id, new.group_id, 'nutrition_prompt_answered', v_name || ' answered a nutrition prompt', '/groups/' || new.group_id::text || '/nutrition?athleteId=' || new.athlete_id::text);
  end loop;
  return new;
end;
$function$;

drop trigger if exists client_nutrition_feedback_notify on public.client_nutrition_feedback;
create trigger client_nutrition_feedback_notify
  after insert on public.client_nutrition_feedback
  for each row execute function public.notify_on_nutrition_feedback();

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 39 (0294)' as step, '0294 food preferences and allergy safety: one preferences row per client' as what, not ((to_regclass('public.client_nutrition_preferences') is null) and (to_regclass('public.client_nutrition_feedback') is null)) as in_place
) as result order by step;
