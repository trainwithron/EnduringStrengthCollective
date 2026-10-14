-- UNDO for step 121 (0371). Only if step 121 misbehaves. Removes the marks (every imported set is a plain set again, exactly as entered).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.set_unclear_point_counted(uuid, boolean);
drop function if exists public.flag_unclear_sets(uuid, uuid);
drop trigger if exists set_logs_guard_flag_insert on public.set_logs;
drop trigger if exists set_logs_guard_flag_update on public.set_logs;
drop function if exists public.guard_set_log_flag_columns();
drop index if exists public.set_logs_unclear_idx;
alter table public.set_logs drop constraint if exists set_logs_data_flag_check;
alter table public.set_logs drop column if exists data_flag, drop column if exists data_flag_reason;
commit;
