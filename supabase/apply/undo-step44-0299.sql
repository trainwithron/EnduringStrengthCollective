-- UNDO for step 44 (0299). Only if step 44 gets in the way of something. Removes the two triggers and the function and gives the app's roles back the privileges they had before. No acceptance record is touched.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists legal_acceptances_no_truncate on public.legal_acceptances;
drop trigger if exists legal_acceptances_append_only on public.legal_acceptances;
drop function if exists public.legal_acceptances_refuse_changes();
grant update, delete, truncate, references, trigger on public.legal_acceptances to anon, authenticated;
commit;
