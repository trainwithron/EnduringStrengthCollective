-- RELEASE T1 (DOWNLOAD MY DATA GIVES A PERSON EVERYTHING THE APP HOLDS ABOUT THEM; ADDS TWO FUNCTIONS AND A PRIVATE BUCKET, SAFE BEFORE THE CODE): ONE paste. Steps 164 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 164: Nothing changes on screen until the Release T1 code is live. Adds two functions, export_my_data_tables and export_my_data_table, that a signed-in person runs as themselves to collect, a page at a time, every row they can read that names them, and an empty private bucket (account-exports) for a download too large to send directly. Safe to run before the code.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release T1 (Download my data gives a person everything the app holds about them; adds two functions and a private bucket, safe before the code), step 164: 0412 Release T1: Download my data gives a person everything the app holds about them (two small functions and a private bucket)
do $g164$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0412 is not already applied (the functions are not there yet)', to_regprocedure('public.export_my_data_tables()') is null),
      ('the table it reads from exists', to_regclass('public.profiles') is not null),
      ('the storage bucket table exists', to_regclass('storage.buckets') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release T1 (Download my data gives a person everything the app holds about them; adds two functions and a private bucket, safe before the code), step 164 (0412) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g164$;

-- ====================================================================================================
-- migration 0412_export_my_data.sql
-- ====================================================================================================

-- Release T1 (trust pack): "Download my data" gives a person everything the app holds about them as a member and client, not a hand-picked list.
--
-- The download used to be a list of about twenty tables written by hand, so every table added since (the food log, meal plans, goals, messages, bookings, notices, check-ins ...) was silently missing. Two small functions
-- find the tables themselves and hand them over one page at a time, each page its own short database call, so a person with a lot of data is never cut off by one slow call:
--   export_my_data_tables()  lists the (table, column) pairs to read: every table with a column that names the person (athlete, profile, author, user, sender, recipient, client, a training-partner request they sent or
--                            were sent, an invite addressed to them, a person they blocked ...). Cheap.
--   export_my_data_table()   returns one page of the person's own rows from one of those tables, newest first, in a fixed order, with a flag saying whether there is more.
-- Both run AS THE PERSON (security invoker), so they can only return rows their own sign-in can already read: a coach's private notes about a client, or anything else row security hides from them, are not in it, and no other
-- person's data can come out. Sign-in tokens and secrets are left out (access and refresh tokens, push keys, a kiosk PIN and its hash, link tokens and their hashes, API key hashes), and so are the tables that hold only
-- those. The table and column asked for must be on the list above, and are only ever used as quoted identifiers. A coach's business records (coach_id) are not here: coaches use Export my business.
-- A private storage bucket is added for a download too large to send directly (the app hands out a short-lived link and deletes the file after a day). Adds two functions and one empty bucket. Re-runnable.
create or replace function public.export_my_data_tables()
returns table (tbl text, col text)
language sql
stable
security invoker
set search_path = public
as $$
  select t.tbl, t.col
    from (
      select 'profiles'::text as tbl, 'id'::text as col
      union
      select cl.relname::text, a.attname::text
        from pg_constraint c
        join pg_class cl on cl.oid = c.conrelid and cl.relkind = 'r'
        join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f'
         and c.confrelid = 'public.profiles'::regclass
         and array_length(c.conkey, 1) = 1
         and a.attname in ('athlete_id', 'profile_id', 'author_id', 'user_id', 'sender_id', 'recipient_id', 'client_id', 'from_athlete_id', 'to_athlete_id', 'invited_profile_id', 'blocker_id')
         and cl.relname not in ('wearable_oauth_tokens', 'google_calendar_oauth_tokens', 'push_subscriptions', 'guardian_links', 'kiosk_pins', 'client_removals', 'client_removal_log', 'coach_api_keys', 'pending_email_changes')
         and has_table_privilege(cl.oid, 'select')
    ) t
   order by t.tbl, t.col;
$$;
revoke execute on function public.export_my_data_tables() from public, anon;
grant execute on function public.export_my_data_tables() to authenticated;

create or replace function public.export_my_data_table(p_table text, p_col text, p_offset integer default 0, p_limit integer default 1000)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 2000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_pk text;
  v_order text;
  v_rows jsonb;
  v_count integer;
  v_more boolean := false;
  c_secret constant text[] := array['kiosk_pin', 'pin_hash', 'access_token', 'refresh_token', 'auth_key', 'p256dh', 'token_hash', 'cancel_token_hash', 'api_key_hash', 'reply_token'];
begin
  if me is null then
    raise exception 'Sign in to download your data.';
  end if;
  if not exists (select 1 from public.export_my_data_tables() x where x.tbl = p_table and x.col = p_col) then
    raise exception 'That is not part of the download.';
  end if;

  -- a fixed order (newest first when the table has a created_at, then its primary key) so a download is the same every time and a cut keeps the newest rows
  select string_agg(quote_ident(a.attname), ', ' order by k.ord) into v_pk
    from pg_index i
    cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  v_order := concat_ws(', ',
    case when exists (select 1 from pg_attribute a where a.attrelid = format('public.%I', p_table)::regclass and a.attname = 'created_at' and not a.attisdropped) then 'created_at desc nulls last' end,
    v_pk);
  if v_order is null or v_order = '' then v_order := 'ctid'; end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) - $2), ''[]''::jsonb), count(*)::integer from (select * from public.%I where %I = $1 order by %s offset %s limit %s) t',
    p_table, p_col, v_order, v_offset, v_limit + 1
  ) into v_rows, v_count using me, c_secret;

  if v_count > v_limit then
    v_more := true;
    v_rows := (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from jsonb_array_elements(v_rows) with ordinality as x(e, i) where i <= v_limit);
  end if;
  return jsonb_build_object('rows', v_rows, 'more', v_more);
end;
$$;
revoke execute on function public.export_my_data_table(text, text, integer, integer) from public, anon;
grant execute on function public.export_my_data_table(text, text, integer, integer) to authenticated;

-- Private bucket for a download too large to send directly. No policies: only the server key reaches it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('account-exports', 'account-exports', false, 104857600)
on conflict (id) do nothing;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 164 (0412)' as step, '0412 Release T1: Download my data gives a person everything the app holds about them' as what, not ((to_regprocedure('public.export_my_data_tables()') is null)) as in_place
) as result order by step;
