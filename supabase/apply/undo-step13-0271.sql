-- UNDO for step 13 (0271). Only if something breaks that worked before step 13 (for example a page that signs the visitor out and shows 'permission denied for function'). Puts function permissions back exactly as they were (everyone can run everything). Tell Spot which page failed.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
grant execute on all functions in schema public to public, anon, authenticated, service_role;
alter default privileges grant execute on functions to public;
alter default privileges in schema public grant execute on functions to anon;
commit;
