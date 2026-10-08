-- UNDO for step 56 (0311). Only if step 56 misbehaves. Removes the tries table (and the copies of earlier plans in it), the two functions, any try notices already sent, and the notification type. Plans already rebuilt for a client stay exactly as they are now (they are normal plans).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.restore_meal_plan_try(uuid);
drop function if exists public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text);
drop function if exists public.meal_plan_try_number(text);
drop table if exists public.meal_plan_tries;
delete from public.notifications where type = 'meal_plan_try';
do $undo$ declare v_def text; v_types text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; select array_agg(m[1] order by m[1]) into v_types from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m where m[1] <> 'meal_plan_try'; alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_types) as t)); end $undo$;
commit;
