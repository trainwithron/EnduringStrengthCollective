-- STEP 45: 0300 Food search and logging: USDA household portions (public reference table), a record of which USDA batches were loaded, and the optional detail of a searched food on a food log entry (source, USDA food, grams, serving, nutrient snapshot), with sanity limits on what can be logged from now on
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for anyone until the code in the same release is live. After that: any client can search the USDA foods, pick a serving (grams, ounces, household measures once the USDA portions are loaded), see the nutrients and log it, then edit or delete the entry. Existing food logs are untouched.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.usda_food_portions') is null)
     and (not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'food_log_entries' and column_name = 'fdc_id'))) then
    raise exception 'Step 45 (0300) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
-- Nothing here changes who can read or write a food log: a client writes only their own, their group's coach reads it (0162). Re-runnable.

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

commit;
