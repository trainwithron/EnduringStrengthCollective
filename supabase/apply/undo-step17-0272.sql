-- UNDO for step 17 (0272). Only if the public discovery-call page or the gym QR form stops working after step 17. Re-opens those two functions to the browser (the old way).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
grant execute on function public.book_discovery_call(uuid, timestamptz, timestamptz, text, text, text, text) to anon, authenticated;
grant execute on function public.submit_gym_visitor_lead(uuid, uuid, text, text, text) to anon, authenticated;
commit;
