-- RELEASE T2 (A FINGERPRINT COLUMN SO WEARABLE SIGN-IN TOKENS CAN BE KEPT SCRAMBLED; ADDS ONE EMPTY COLUMN, RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 165 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 165: Nothing changes on screen. Adds one empty column to the wearable sign-in token table; the app fills it in itself. Nothing is scrambled until the key is set in Vercel. Run this BEFORE the Release T2 code is live (the Garmin lookup and the daily protect job read the column).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release T2 (a fingerprint column so wearable sign-in tokens can be kept scrambled; adds one empty column, run BEFORE the code that goes with it is live), step 165: 0413 Release T2: a fingerprint column so wearable sign-in tokens can be kept scrambled (one empty column and an index)
do $g165$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0413 is not already applied (the fingerprint column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wearable_oauth_tokens' and column_name = 'access_token_hash')),
      ('the table it builds on exists', to_regclass('public.wearable_oauth_tokens') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release T2 (a fingerprint column so wearable sign-in tokens can be kept scrambled; adds one empty column, run BEFORE the code that goes with it is live), step 165 (0413) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g165$;

-- ====================================================================================================
-- migration 0413_wearable_token_fingerprint.sql
-- ====================================================================================================

-- Release T2 (trust pack): a wearable connection's sign-in token can be kept scrambled in the database.
--
-- Garmin sends its updates carrying the person's token and nothing else, so the app has always found the connection by looking the token up in the table. Once the token is stored scrambled that lookup can no longer
-- work, so each token also gets a one-way fingerprint (a SHA-256 of the token: not secret, cannot be turned back into the token) and the lookup uses that. Adds one empty column and one index. Nothing is scrambled by this
-- file: the app does that only after WEARABLE_TOKEN_KEY is set, and fills this column in itself. Re-runnable.
alter table public.wearable_oauth_tokens add column if not exists access_token_hash text;
create index if not exists wearable_oauth_tokens_access_token_hash_idx on public.wearable_oauth_tokens (access_token_hash) where access_token_hash is not null;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 165 (0413)' as step, '0413 Release T2: a fingerprint column so wearable sign-in tokens can be kept scrambled' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wearable_oauth_tokens' and column_name = 'access_token_hash'))) as in_place
) as result order by step;
