-- Release CP: switch on the guard made by 0386. From now on a signed-in person's browser cannot change the completion columns of client_intake (answers, signed name, accepted, completed time), on insert
-- or update; the server (service role) and the database owner still can. RUN THIS AFTER the Release D code is live: the old health form wrote those columns from the browser and would be refused.

drop trigger if exists client_intake_guard_completion on public.client_intake;
create trigger client_intake_guard_completion
  before insert or update on public.client_intake
  for each row execute function public.client_intake_guard_completion();
