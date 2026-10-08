-- UNDO for step 54 (0309). Only if step 54 misbehaves. Removes the trigger, the function, any new-training-block notices already sent, and the notification type.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists client_phase_plans_notify_new_block on public.client_phase_plans;
drop function if exists public.notify_on_new_training_block();
delete from public.notifications where type = 'new_training_block';
do $undo$ declare v_def text; v_types text[]; begin select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass; select array_agg(m[1] order by m[1]) into v_types from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m where m[1] <> 'new_training_block'; alter table public.notifications drop constraint notifications_type_check; execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_types) as t)); end $undo$;
commit;
