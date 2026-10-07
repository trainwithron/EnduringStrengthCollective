-- STEP 37: 0292 the AI call log records why a call failed (a short error class), so an AI outage can be diagnosed
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes. After the code deploy every failed AI call records a short class (key rejected, credit or spend limit, rate limit, overloaded, timeout, bad request, unknown) and the nightly AI jobs show as failed when every item failed. Run after step 36.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_log' and column_name = 'error_class'))) then
    raise exception 'Step 37 (0292) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0292_ai_usage_error_class.sql
-- ====================================================================================================

-- Release F, part 3: record WHY an AI call failed (Assistant, Oct 7: every real AI call has failed since Oct 5 18:46 UTC and the database kept no error text, so the
-- cause could not be named). ai_usage_log gets one nullable column, error_class, written by the server when a call fails: a short class such as
-- 'auth' (key rejected), 'credit' (the Anthropic balance or spend limit), 'rate_limit', 'overloaded', 'timeout', 'bad_request' or 'unknown'. It never holds the
-- message or anything the person typed. Nothing reads it yet except the job monitor and Spot. No existing row or caller changes. Re-runnable.

alter table public.ai_usage_log add column if not exists error_class text;
alter table public.ai_usage_log drop constraint if exists ai_usage_log_error_class_len;
alter table public.ai_usage_log add constraint ai_usage_log_error_class_len check (error_class is null or char_length(error_class) <= 40);

commit;
