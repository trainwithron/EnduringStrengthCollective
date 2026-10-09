-- UNDO for step 65 (0319). Only if step 65 misbehaves. Takes the fixed search paths off the two audit functions and gives rls_auto_enable back to the public, signed-out visitors and signed-in users, exactly as before.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter function public.audit_log_refuse_changes() reset search_path;
alter function public.audit_diff(jsonb, jsonb, text[]) reset search_path;
do $u$ begin if to_regprocedure('public.rls_auto_enable()') is not null then execute 'grant execute on function public.rls_auto_enable() to public, anon, authenticated'; end if; end $u$;
commit;
