-- Release T1 (trust pack): "Download my data" gives a person EVERYTHING the app holds about them that they can read, not a hand-picked list.
--
-- The export used to be a list of about twenty tables written by hand, so every table added since (the food log, meal plans, goals, messages, bookings, notifications, check-ins ...) was silently missing. This function
-- finds the tables itself: every table in the app that has a column pointing at the person (athlete_id, profile_id, author_id, user_id, sender_id, recipient_id ...) and returns the person's own rows from each one.
-- It runs AS THE PERSON (security invoker), so it can only return rows their own sign-in can already read: a coach's private notes about a client, or anything else row security hides from them, are not in it, and no
-- other person's data can come out of it. Sign-in tokens and secrets are left out (access and refresh tokens, push keys, a kiosk PIN, a parent-link token). A table with more than 50,000 rows for one person is cut at
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
       and a.attname in ('athlete_id', 'profile_id', 'author_id', 'user_id', 'sender_id', 'recipient_id', 'to_athlete_id', 'from_athlete_id', 'client_id', 'linked_athlete_id', 'invited_profile_id')
       and cl.relname not in ('wearable_oauth_tokens', 'google_calendar_oauth_tokens', 'push_subscriptions', 'guardian_links', 'client_removals', 'client_nutrition_flags')
       and has_table_privilege(cl.oid, 'select')
     order by 1, 2
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) - ''kiosk_pin'' - ''access_token'' - ''refresh_token'' - ''p256dh'' - ''auth'' - ''token''), ''[]''::jsonb), count(*)::integer from (select * from public.%I where %I = $1 limit %s) t',
      r.tbl, r.col, c_cap + 1
    ) into v_rows, v_count using me;
    if v_count > 0 then
      if v_count > c_cap then
        -- cut at the cap: drop the extra row and say so
        v_rows := (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(v_rows) with ordinality as x(e, i) where i <= c_cap) q);
      end if;
      v_out := v_out || jsonb_build_object(r.tbl || '.' || r.col, jsonb_build_object('rows', v_rows, 'truncated', v_count > c_cap));
    end if;
  end loop;
  return v_out;
end;
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
