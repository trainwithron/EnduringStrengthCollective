-- Release T2 (trust pack): a wearable connection's sign-in token can be kept scrambled in the database.
--
-- Garmin sends its updates carrying the person's token and nothing else, so the app has always found the connection by looking the token up in the table. Once the token is stored scrambled that lookup can no longer
-- work, so each token also gets a one-way fingerprint (a SHA-256 of the token: not secret, cannot be turned back into the token) and the lookup uses that. Adds one empty column and one index. Nothing is scrambled by this
-- file: the app does that only after WEARABLE_TOKEN_KEY is set, and fills this column in itself. Re-runnable.
alter table public.wearable_oauth_tokens add column if not exists access_token_hash text;
create index if not exists wearable_oauth_tokens_access_token_hash_idx on public.wearable_oauth_tokens (access_token_hash) where access_token_hash is not null;
