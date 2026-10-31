-- Undo step 196 (0441): back to the request being sent only after the email is confirmed.
create or replace function public.submit_client_request(p_coach uuid, p_dob date default null) returns jsonb language plpgsql security definer set search_path to 'public' as $f$
begin
  -- the core stays (it is the same checks); only the sign-up path goes
  return public.client_request_submit_core(auth.uid(), p_coach, p_dob);
end;
$f$;
drop function if exists public.submit_client_request_at_signup(uuid, uuid, date);
