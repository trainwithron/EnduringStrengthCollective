-- Release F, part 3: record WHY an AI call failed (Assistant, Oct 7: every real AI call has failed since Oct 5 18:46 UTC and the database kept no error text, so the
-- cause could not be named). ai_usage_log gets one nullable column, error_class, written by the server when a call fails: a short class such as
-- 'auth' (key rejected), 'credit' (the Anthropic balance or spend limit), 'rate_limit', 'overloaded', 'timeout', 'bad_request' or 'unknown'. It never holds the
-- message or anything the person typed. Nothing reads it yet except the job monitor and Spot. No existing row or caller changes. Re-runnable.

alter table public.ai_usage_log add column if not exists error_class text;
alter table public.ai_usage_log drop constraint if exists ai_usage_log_error_class_len;
alter table public.ai_usage_log add constraint ai_usage_log_error_class_len check (error_class is null or char_length(error_class) <= 40);
