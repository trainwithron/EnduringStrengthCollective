-- UNDO for step 39 (0294). Only if food preferences misbehave after step 39. Removes the two tables (every saved preference and answer is lost), their triggers and helper functions, deletes the two new kinds of notification, and puts the notification types back to the list the database had without them (read from the live list, so another release's types are kept). Nothing else is touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $undo$ declare v_def text; v_have text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; delete from public.notifications where type in ('nutrition_preferences_changed', 'nutrition_prompt_answered'); select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') as m; v_have := array(select t from unnest(v_have) as t where t not in ('nutrition_preferences_changed', 'nutrition_prompt_answered')); alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_have) as t)); end $undo$;
drop trigger if exists client_nutrition_feedback_notify on public.client_nutrition_feedback;
drop trigger if exists client_nutrition_feedback_guard on public.client_nutrition_feedback;
drop trigger if exists client_nutrition_preferences_notify on public.client_nutrition_preferences;
drop trigger if exists client_nutrition_preferences_guard on public.client_nutrition_preferences;
drop table if exists public.client_nutrition_feedback;
drop table if exists public.client_nutrition_preferences;
drop function if exists public.notify_on_nutrition_feedback();
drop function if exists public.guard_client_nutrition_feedback();
drop function if exists public.notify_on_nutrition_preferences();
drop function if exists public.guard_client_nutrition_preferences();
drop function if exists public.nutrition_allergies_ok(text[]);
drop function if exists public.nutrition_list_ok(text[], int, int);
commit;
