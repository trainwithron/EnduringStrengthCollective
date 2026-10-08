-- RELEASE N (NUTRITION TRACKING: FOOD SEARCH, CUSTOM FOODS, NUTRIENT DETAIL): ONE paste. Steps 45, 46 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 45: Nothing changes for anyone until the code in the same release is live. After that: any client can search the USDA foods, pick a serving (grams, ounces, household measures once the USDA portions are loaded), see the nutrients and log it, then edit or delete the entry. Existing food logs are untouched.
-- AFTER STEP 46: Nothing changes for anyone until the code in the same release is live. After that: each coach has one monthly AI budget measured in real cost; the app tells the coach plainly at about 80 percent and when it is used up, and pauses AI features until the 1st. Food search, barcode and saved meals are never limited.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release N (nutrition tracking: food search, custom foods, nutrient detail), step 45: 0300 Food search and logging: USDA household portions (public reference table), a record of which USDA batches were loaded, and the optional detail of a searched food on a food log entry (source, USDA food, grams, serving, nutrient snapshot), with sanity limits on what can be logged from now on
do $g45$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('food_log_entries and usda_foods exist', to_regclass('public.food_log_entries') is not null and to_regclass('public.usda_foods') is not null),
      ('0300 is not already applied (usda_food_portions is not there yet)', to_regclass('public.usda_food_portions') is null),
      ('0300 is not already applied (food_log_entries has no fdc_id yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'food_log_entries' and column_name = 'fdc_id')),
      ('0300 is not already applied (group_memberships has no food_tracking_enabled yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'food_tracking_enabled'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release N (nutrition tracking: food search, custom foods, nutrient detail), step 45 (0300) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g45$;

-- ====================================================================================================
-- migration 0300_food_search_logging.sql
-- ====================================================================================================

-- Food search and logging (nutrition tracking, phase 1). Every client can search the USDA foods already in the database, pick a serving, see the nutrients and log it.
--
--  * usda_food_portions: the household measures USDA publishes for a food ("1 cup, chopped" = 140 g), as public reference data. Read by any signed-in person, written only by the
--    import script (the server key); empty until that import runs, and the app works without it (grams and ounces are always offered).
--  * usda_load_batches: one row per import batch that was loaded in full (the import writes a batch and its marker in one transaction), so an interrupted load is resumable and
--    a half-loaded batch can never be mistaken for a finished one.
--  * food_log_entries gets the optional detail of a searched food: where it came from, the USDA food, the grams logged, the serving as shown ("1 cup, chopped" x 1.5), and a
--    snapshot of the nutrients for the amount logged (a missing key means "not reported", never zero). Existing rows and every existing way of logging are untouched.
--  * Sanity limits on what can be logged from now on (new rows only; existing rows are not rechecked).
--  * group_memberships.food_tracking_enabled (default true): a coach can turn food tracking off for a client who does not track. The client's Nutrition page then says so and
--    offers no logging; nothing already logged is removed. Written by the coach the same way as the other per-client switches on a membership.
-- Nothing here changes who can read or write a food log: a client writes only their own, their group's coach reads it (0162). Re-runnable.

-- Nullable on purpose (null counts as on): a bulk restore of memberships from a backup file fills columns it does not know with null, and a NOT NULL here would break it.
alter table public.group_memberships add column if not exists food_tracking_enabled boolean default true;

create table if not exists public.usda_food_portions (
  id bigint generated always as identity primary key,
  fdc_id integer not null references public.usda_foods(fdc_id) on delete cascade,
  seq integer not null,
  description text not null check (char_length(description) between 1 and 200),
  gram_weight numeric not null check (gram_weight > 0 and gram_weight < 100000),
  unique (fdc_id, seq)
);
create index if not exists usda_food_portions_fdc_idx on public.usda_food_portions (fdc_id);

alter table public.usda_food_portions enable row level security;
drop policy if exists "usda_food_portions_select_all" on public.usda_food_portions;
create policy "usda_food_portions_select_all" on public.usda_food_portions for select to authenticated using (true);
revoke all on public.usda_food_portions from anon;
revoke insert, update, delete, truncate, references, trigger on public.usda_food_portions from authenticated;

create table if not exists public.usda_load_batches (
  name text primary key,
  rows_loaded integer not null check (rows_loaded >= 0),
  loaded_at timestamptz not null default now()
);
alter table public.usda_load_batches enable row level security;
drop policy if exists "usda_load_batches_select_all" on public.usda_load_batches;
create policy "usda_load_batches_select_all" on public.usda_load_batches for select to authenticated using (true);
revoke all on public.usda_load_batches from anon;
revoke insert, update, delete, truncate, references, trigger on public.usda_load_batches from authenticated;

alter table public.food_log_entries
  add column if not exists food_source text,
  add column if not exists fdc_id integer references public.usda_foods(fdc_id) on delete set null,
  add column if not exists amount_g numeric,
  add column if not exists serving_label text,
  add column if not exists serving_qty numeric,
  add column if not exists nutrients jsonb,
  add column if not exists barcode text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'food_log_entries_food_source_check') then
    alter table public.food_log_entries add constraint food_log_entries_food_source_check
      check (food_source is null or food_source in ('usda', 'custom', 'saved_meal', 'barcode', 'ai', 'plan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'food_log_entries_detail_check') then
    alter table public.food_log_entries add constraint food_log_entries_detail_check
      check (
        (amount_g is null or (amount_g > 0 and amount_g <= 20000))
        and (serving_qty is null or (serving_qty > 0 and serving_qty <= 10000))
        and (serving_label is null or char_length(serving_label) <= 120)
        and (barcode is null or char_length(barcode) <= 32)
        and (nutrients is null or (jsonb_typeof(nutrients) = 'object' and pg_column_size(nutrients) <= 12000))
      );
  end if;
  -- Sane amounts for anything logged from now on. NOT VALID: new and edited rows are checked, rows already in the table are left alone.
  if not exists (select 1 from pg_constraint where conname = 'food_log_entries_amounts_sane') then
    alter table public.food_log_entries add constraint food_log_entries_amounts_sane
      check (
        (calories is null or (calories >= 0 and calories <= 20000))
        and (protein_g is null or (protein_g >= 0 and protein_g <= 2000))
        and (carbs_g is null or (carbs_g >= 0 and carbs_g <= 5000))
        and (fat_g is null or (fat_g >= 0 and fat_g <= 2000))
      ) not valid;
  end if;
end $$;

-- ===== Release N (nutrition tracking: food search, custom foods, nutrient detail), step 46: 0301 AI budget: this month's AI use per coach summed by model (server-only), and a record that a coach was told their AI is running low or used up, once per month
do $g46$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('ai_usage_log exists', to_regclass('public.ai_usage_log') is not null),
      ('0301 is not already applied (ai_month_usage is not there yet)', not exists (select 1 from pg_proc where proname = 'ai_month_usage' and pronamespace = 'public'::regnamespace)),
      ('0301 is not already applied (ai_budget_notices is not there yet)', to_regclass('public.ai_budget_notices') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release N (nutrition tracking: food search, custom foods, nutrient detail), step 46 (0301) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g46$;

-- ====================================================================================================
-- migration 0301_ai_budget.sql
-- ====================================================================================================

-- AI budget (nutrition tracking, phase 1). One monthly AI budget per coach, measured in real cost: every AI call is already logged with its model and token counts
-- (ai_usage_log, 0226); the app prices those tokens and compares the month's total with the coach's budget. This migration adds the two small pieces the database has to hold.
--
--  * ai_month_usage(coach, since): this month's AI use for one coach, summed by model (input tokens, output tokens, calls), counting only calls that finished (ok or cut off after
--    producing output); a failed call is never counted. Server-only: it reads a table nobody can read from the app. Priced in the app (lib/ai-budget.ts), so a price change
--    never needs a database change.
--  * ai_budget_notices: one row per coach, month and level ('low' = about 80 percent, 'out' = used up) so the coach is told ONCE, not on every request.
-- Nothing here changes who can read or write anything else. Re-runnable.

create or replace function public.ai_month_usage(p_coach_id uuid, p_since timestamptz default null)
returns table(model text, input_tokens bigint, output_tokens bigint, calls bigint)
language sql
stable
security definer
set search_path = public
as $function$
  select l.model,
         coalesce(sum(l.input_tokens), 0)::bigint,
         coalesce(sum(l.output_tokens), 0)::bigint,
         count(*)::bigint
  from public.ai_usage_log l
  where l.coach_id = p_coach_id
    and l.created_at >= coalesce(p_since, (date_trunc('month', now() at time zone 'utc')) at time zone 'utc')
    and l.status in ('ok', 'truncated')
  group by l.model;
$function$;

revoke all on function public.ai_month_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_month_usage(uuid, timestamptz) to service_role;

create table if not exists public.ai_budget_notices (
  coach_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  level text not null check (level in ('low', 'out')),
  created_at timestamptz not null default now(),
  primary key (coach_id, month, level)
);
alter table public.ai_budget_notices enable row level security;
-- No policy at all: only the server (service role) reads or writes it.
revoke all on public.ai_budget_notices from anon, authenticated;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 45 (0300)' as step, '0300 Food search and logging: USDA household portions' as what, not ((to_regclass('public.usda_food_portions') is null) and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'food_log_entries' and column_name = 'fdc_id')) and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'food_tracking_enabled'))) as in_place
  union all
  select 'step 46 (0301)' as step, '0301 AI budget: this month''s AI use per coach summed by model' as what, not ((not exists (select 1 from pg_proc where proname = 'ai_month_usage' and pronamespace = 'public'::regnamespace)) and (to_regclass('public.ai_budget_notices') is null)) as in_place
) as result order by step;
