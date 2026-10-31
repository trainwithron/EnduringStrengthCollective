-- Step 196 (Ron, Oct 31: "let's do the better system for the coach requests").
-- A visitor who makes an account on a coach's "Request to train" page had to open the confirmation email before the request was
-- sent. At the gym that email was not found, so the coach never heard. Now the account and the request are made together, and the
-- coach is told at once; their list says when the person has not confirmed their email yet.
--
-- 1. client_request_submit_core(p_me, p_coach, p_dob): the checks and the insert, unchanged, for a given person (was inside
--    submit_client_request, which read auth.uid()). Not callable by anyone signed in: only the two functions below and the server.
-- 2. submit_client_request(p_coach, p_dob): the signed-in path, same as before, now one line over the core.
-- 3. submit_client_request_at_signup(p_requester, p_coach, p_dob): the server only (service role), right after it made the account in
--    the same request. Only an account made in the last 15 minutes and not yet confirmed; makes the profile row from the name given
--    at sign-up when there is none yet (the coach's list joins on it).
-- 4. coach_client_requests: adds email_confirmed.

create or replace function public.client_request_submit_core(p_me uuid, p_coach uuid, p_dob date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := p_me;
  v_org uuid;
  v_known date;
  v_dob date;
  v_id uuid;
  v_name text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'code', 'not_signed_in', 'message', 'Sign in first.');
  end if;
  -- one try at a time per account and per coach, so two presses at once cannot both get past a limit or both make a request
  perform pg_advisory_xact_lock(hashtextextended('client_request:account:' || me::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('client_request:coach:' || coalesce(p_coach::text, ''), 0));
  delete from public.client_request_attempts where profile_id = me and at < now() - interval '2 days';
  if (select count(*) from public.client_request_attempts a where a.profile_id = me and a.at > now() - interval '1 hour') >= 5 then
    insert into public.client_request_attempts (profile_id, outcome) values (me, 'too_many');
    return jsonb_build_object('ok', false, 'code', 'too_many', 'message', 'Too many requests. Try again later.');
  end if;
  insert into public.client_request_attempts (profile_id, outcome) values (me, 'tried');

  -- the coach's public page must be on and taking requests, and the coach must belong to an organization (the one the page wears)
  v_org := public.client_request_org(p_coach);
  if p_coach is null or v_org is null or not exists (select 1 from public.coach_booking_pages p where p.coach_id = p_coach and p.enabled and p.accepts_requests) then
    return jsonb_build_object('ok', false, 'code', 'not_taking', 'message', 'This coach is not taking requests through this page.');
  end if;
  if p_coach = me then
    return jsonb_build_object('ok', false, 'code', 'own_page', 'message', 'This is your own page.');
  end if;
  if exists (select 1 from public.client_request_blocks b where b.profile_id = me and b.until > now()) then
    return jsonb_build_object('ok', false, 'code', 'under_13', 'message', 'Coaching here is for ages 13 and up. Ask a parent to contact the coach.');
  end if;
  -- the YOUNGER of the date on file (either of the two places it is kept) and the one typed now: a date typed to look older never wins
  select greatest((select ci.date_of_birth from public.client_intake ci where ci.athlete_id = me limit 1), (select d.birthday from public.athlete_profile_details d where d.athlete_id = me limit 1)) into v_known;
  if p_dob is not null and (p_dob > current_date or p_dob < date '1900-01-01') then
    return jsonb_build_object('ok', false, 'code', 'dob_invalid', 'message', 'That date of birth is not a real date.');
  end if;
  v_dob := greatest(v_known, p_dob);
  if v_dob is null then
    return jsonb_build_object('ok', false, 'code', 'dob_needed', 'message', 'Please enter your date of birth.');
  end if;
  if current_date < public.age_threshold_date(v_dob, 13) then
    insert into public.client_request_blocks (profile_id, until) values (me, now() + interval '30 days') on conflict (profile_id) do update set until = greatest(public.client_request_blocks.until, excluded.until);
    update public.client_request_attempts set outcome = 'under_13' where id = (select max(id) from public.client_request_attempts where profile_id = me);
    return jsonb_build_object('ok', false, 'code', 'under_13', 'message', 'Coaching here is for ages 13 and up. Ask a parent to contact the coach.');
  end if;
  if exists (
    select 1 from public.group_memberships a
    join public.group_memberships c on c.group_id = a.group_id and c.profile_id = p_coach and c.role = 'coach'
    join public.groups g on g.id = a.group_id and g.organization_id = v_org
    where a.profile_id = me and a.role = 'athlete'
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_client', 'message', 'You already train with this coach.');
  end if;
  -- one waiting request per person for this coach: the same request comes back
  select r.id into v_id from public.client_requests r where r.coach_id = p_coach and r.organization_id = v_org and r.requester_id = me and r.status = 'pending';
  if v_id is not null then
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  -- a decline holds for 30 days with this coach
  if exists (select 1 from public.client_requests r where r.coach_id = p_coach and r.organization_id = v_org and r.requester_id = me and r.status = 'declined' and r.decided_at > now() - interval '30 days') then
    return jsonb_build_object('ok', false, 'code', 'declined_recently', 'message', 'This coach is not taking new clients right now. You can ask again later.');
  end if;
  if (select count(*) from public.client_requests r where r.coach_id = p_coach and r.status = 'pending') >= 50 then
    return jsonb_build_object('ok', false, 'code', 'coach_full', 'message', 'This coach has a lot of requests waiting right now. Please try again later.');
  end if;
  if (select count(*) from public.client_requests r where r.coach_id = p_coach and r.created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('ok', false, 'code', 'too_many', 'message', 'Too many requests for this coach right now. Try again later.');
  end if;

  begin
    insert into public.client_requests (coach_id, organization_id, requester_id, requester_dob) values (p_coach, v_org, me, v_dob) returning id into v_id;
  exception when unique_violation then
    select r.id into v_id from public.client_requests r where r.coach_id = p_coach and r.organization_id = v_org and r.requester_id = me and r.status = 'pending';
    return jsonb_build_object('ok', true, 'id', v_id);
  end;

  -- the coach is told, by First L. only (the full name comes with Approve)
  select p.full_name into v_name from public.profiles p where p.id = me;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (p_coach, null, 'client_request', public.client_request_short_name(v_name) || ' asked to train with you.', '/clients/requests');
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;

revoke all on function public.client_request_submit_core(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.client_request_submit_core(uuid, uuid, date) to service_role;

create or replace function public.submit_client_request(p_coach uuid, p_dob date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public.client_request_submit_core(auth.uid(), p_coach, p_dob);
end;
$function$;

create or replace function public.submit_client_request_at_signup(p_requester uuid, p_coach uuid, p_dob date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
begin
  -- only an account the server made moments ago and that nobody has signed in to yet (it cannot speak for an older account)
  select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1), 'New member') into v_name
  from auth.users u
  where u.id = p_requester and u.created_at > now() - interval '15 minutes' and u.email_confirmed_at is null and u.last_sign_in_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_signed_in', 'message', 'Sign in first.');
  end if;
  insert into public.profiles (id, full_name) values (p_requester, left(v_name, 120)) on conflict (id) do nothing;
  return public.client_request_submit_core(p_requester, p_coach, p_dob);
end;
$function$;

revoke all on function public.submit_client_request_at_signup(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.submit_client_request_at_signup(uuid, uuid, date) to service_role;

drop function if exists public.coach_client_requests(text, uuid);
create function public.coach_client_requests(p_status text default 'pending', p_org uuid default null)
returns table(id uuid, display_name text, avatar_url text, age_band text, status text, created_at timestamptz, email_confirmed boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r.id,
         public.client_request_short_name(p.full_name),
         null::text,
         case when r.requester_dob is null then 'unknown' when current_date >= public.age_threshold_date(r.requester_dob, 18) then 'adult' else 'teen' end,
         r.status, r.created_at,
         exists (select 1 from auth.users u where u.id = r.requester_id and u.email_confirmed_at is not null)
  from public.client_requests r
  join public.profiles p on p.id = r.requester_id
  where r.coach_id = auth.uid() and auth.uid() is not null and r.status = coalesce(nullif(p_status, ''), 'pending')
    and (p_org is null or r.organization_id = p_org)
  order by r.created_at desc
  limit 200
$function$;

revoke all on function public.coach_client_requests(text, uuid) from public, anon;
grant execute on function public.coach_client_requests(text, uuid) to authenticated, service_role;
