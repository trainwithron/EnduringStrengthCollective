-- CLIENT SIGN-IN LINKS WORK UNTIL THEY SIGN IN: ONE paste. Step 193, all or nothing.
--
-- New links already last until the client signs in (app update). This brings back the links you ALREADY texted: for each client who has not signed in yet, their newest
-- link that was never used or cancelled now works again (no expiry). Nothing else changes. A link you replaced or cancelled stays dead.
-- WHAT YOU SHOULD SEE: "Success", then one row: links_working_again = 5 (the 5 clients who have not signed in yet, as of Oct 29).
-- ON ERROR: run   rollback;   once, copy the red text, send it to Commander.
-- UNDO: not needed (a coach can cancel any link from the client's Sign-in panel; making a new link also cancels the old one).

begin;

do $g193$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_invites' and column_name = 'revoked_at') then
    raise exception 'Step 193 cannot run: client_invites has no revoked_at column. NOTHING was changed. Send Commander this message.';
  end if;
end
$g193$;

with newest as (
  select distinct on (athlete_id) id, athlete_id, used_at, revoked_at
  from public.client_invites
  order by athlete_id, created_at desc
)
update public.client_invites ci
set expires_at = now() + interval '10 years'
from newest n
join public.profiles p on p.id = n.athlete_id
where ci.id = n.id
  and n.used_at is null
  and n.revoked_at is null
  and p.claimed_at is null;

commit;

select count(*) as links_working_again
from public.client_invites ci
join public.profiles p on p.id = ci.athlete_id
where ci.used_at is null and ci.revoked_at is null and p.claimed_at is null and ci.expires_at > now() + interval '9 years';
