-- UNDO for step 51 (0306). Only if step 51 misbehaves. Removes the trigger, the function, any target-change notices already sent, and the notification type.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists client_macro_target_history_notify on public.client_macro_target_history;
drop function if exists public.notify_on_target_change();
delete from public.notifications where type = 'nutrition_target_changed';
do $undo$ declare v_def text; v_types text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; select array_agg(m[1] order by m[1]) into v_types from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m where m[1] <> 'nutrition_target_changed'; alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_types) as t)); end $undo$;
commit;
