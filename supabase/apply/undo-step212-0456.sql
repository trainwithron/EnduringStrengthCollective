-- UNDO: step 212. Removes discard_imported_one_on_one_space; undoing an import then leaves each person's space in place, renamed Former client (as before this step). Nothing else changes.

begin;

drop function if exists public.discard_imported_one_on_one_space(uuid, uuid);

commit;
