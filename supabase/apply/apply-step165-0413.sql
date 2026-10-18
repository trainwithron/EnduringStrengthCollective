-- STEP 165: 0413 Release T2: a fingerprint column so wearable sign-in tokens can be kept scrambled (one empty column and an index)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen. Adds one empty column to the wearable sign-in token table; the app fills it in itself. Nothing is scrambled until the key is set in Vercel. Run this BEFORE the Release T2 code is live (the Garmin lookup and the daily protect job read the column).
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wearable_oauth_tokens' and column_name = 'access_token_hash'))) then
    raise exception 'Step 165 (0413) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
