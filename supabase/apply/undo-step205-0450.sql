-- Undo step 205: removes the coach's "Client canceled" function (sessions already marked stay as they are).
drop function if exists public.mark_client_cancelled(uuid, boolean);
