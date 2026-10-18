-- RELEASE T1 (DOWNLOAD MY DATA GIVES A PERSON EVERYTHING THE APP HOLDS ABOUT THEM; ADDS ONE FUNCTION, SAFE BEFORE THE CODE): ONE paste. Steps 164 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 164: Nothing changes on screen until the Release T1 code is live. Adds one function, export_my_data, that a signed-in person runs as themselves to collect every row they can read that points at them. Safe to run before the code.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release T1 (Download my data gives a person everything the app holds about them; adds one function, safe before the code), step 164: 0412 Release T1: Download my data gives a person everything the app holds about them (one new function)
do $g164$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0412 is not already applied (the function is not there yet)', to_regprocedure('public.export_my_data()') is null),
      ('the table it reads from exists', to_regclass('public.profiles') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release T1 (Download my data gives a person everything the app holds about them; adds one function, safe before the code), step 164 (0412) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g164$;

-- ====================================================================================================
-- migration 0412_export_my_data.sql
-- ====================================================================================================

-- Release T1 (trust pack): "Download my data" gives a person EVERYTHING the app holds about them that they can read, not a hand-picked list.
--
-- The export used to be a list of about twenty tables written by hand, so every table added since (the food log, meal plans, goals, messages, bookings, notifications, check-ins ...) was silently missing. This function
-- finds the tables itself: every table in the app that has a column pointing at the person (athlete_id, profile_id, author_id, user_id, sender_id, recipient_id ...) and returns the person's own rows from each one.
-- It runs AS THE PERSON (security invoker), so it can only return rows their own sign-in can already read: a coach's private notes about a client, or anything else row security hides from them, are not in it, and no
-- other person's data can come out of it. Sign-in tokens and secrets are left out (access and refresh tokens, push keys, a kiosk PIN and its hash, link tokens and their hashes, API key hashes). A table with more than 50,000 rows for one person is cut at
-- 50,000 and marked "truncated", never silently. Adds one function. Re-runnable.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r record;
  v_out jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_count integer;
  c_cap constant integer := 50000;
  c_secret constant text[] := array['kiosk_pin', 'pin_hash', 'access_token', 'refresh_token', 'auth_key', 'p256dh', 'token_hash', 'cancel_token_hash', 'api_key_hash', 'reply_token'];
begin
  if me is null then
    raise exception 'Sign in to download your data.';
  end if;

  -- the person's own profile
  select to_jsonb(p) into v_rows from public.profiles p where p.id = me;
  v_out := v_out || jsonb_build_object('profiles.id', jsonb_build_object('rows', jsonb_build_array(v_rows), 'truncated', false));

  for r in
    select distinct cl.relname as tbl, a.attname as col
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid and cl.relkind = 'r'
      join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.profiles'::regclass
       and array_length(c.conkey, 1) = 1
       and a.attname in ('athlete_id', 'profile_id', 'author_id', 'user_id', 'sender_id', 'recipient_id', 'client_id')
       and cl.relname not in ('wearable_oauth_tokens', 'google_calendar_oauth_tokens', 'push_subscriptions', 'guardian_links', 'kiosk_pins', 'client_removals', 'client_removal_log', 'coach_api_keys', 'pending_email_changes')
       and has_table_privilege(cl.oid, 'select')
     order by 1, 2
  loop
    begin
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(t) - $2), ''[]''::jsonb), count(*)::integer from (select * from public.%I where %I = $1 limit %s) t',
        r.tbl, r.col, c_cap + 1
      ) into v_rows, v_count using me, c_secret;
      if v_count > 0 then
        if v_count > c_cap then
          -- cut at the cap: drop the extra row and say so
          v_rows := (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_rows) with ordinality as x(e, i) where i <= c_cap);
        end if;
        v_out := v_out || jsonb_build_object(r.tbl || '.' || r.col, jsonb_build_object('rows', v_rows, 'truncated', v_count > c_cap));
      end if;
    exception when others then
      -- a table this sign-in cannot read in full is named, never allowed to break the download
      v_out := v_out || jsonb_build_object(r.tbl || '.' || r.col, jsonb_build_object('rows', '[]'::jsonb, 'truncated', false, 'unreadable', true));
    end;
  end loop;
  return v_out;
end;
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 164 (0412)' as step, '0412 Release T1: Download my data gives a person everything the app holds about them' as what, not ((to_regprocedure('public.export_my_data()') is null)) as in_place
) as result order by step;
