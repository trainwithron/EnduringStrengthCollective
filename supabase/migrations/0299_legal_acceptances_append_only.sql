-- The record of what people agreed to (legal_acceptances, 0255) is only ever added to. Row security already gave nobody a way to change it from the app, but the table still
-- granted UPDATE, DELETE and TRUNCATE to the app's roles and the server key could rewrite it. Now a trigger refuses any change to a row, and any truncate, for every role
-- including the server key, and the privileges are taken away.
--
-- One door stays open on purpose: deleting a person's account removes their acceptances through the foreign key from profiles. That delete runs inside the cascade's own
-- trigger (trigger depth above 1), so it is allowed; a delete aimed at this table directly is depth 1 and is refused.
-- Nothing the app does today updates or deletes a row (acceptances are added with "on conflict do nothing"), so no feature changes. Re-runnable.

create or replace function public.legal_acceptances_refuse_changes()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  -- A cascade from deleting the person's account (profiles -> legal_acceptances) runs inside another trigger.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Legal acceptances are append-only';
end;
$function$;

revoke all on function public.legal_acceptances_refuse_changes() from public, anon, authenticated;

drop trigger if exists legal_acceptances_append_only on public.legal_acceptances;
create trigger legal_acceptances_append_only
  before update or delete on public.legal_acceptances
  for each row execute function public.legal_acceptances_refuse_changes();

drop trigger if exists legal_acceptances_no_truncate on public.legal_acceptances;
create trigger legal_acceptances_no_truncate
  before truncate on public.legal_acceptances
  for each statement execute function public.legal_acceptances_refuse_changes();

-- People can read their own rows (row security) and the server adds rows; nobody needs the rest.
revoke update, delete, truncate, references, trigger on public.legal_acceptances from anon, authenticated;
