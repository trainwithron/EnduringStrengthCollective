-- OPTIONAL. Run only AFTER step 20 (0278), and ideally after step 21 (0279) so requests work. You can skip it and pick the mode yourself on the Availability page instead.
-- Sets ONE coach to 'Clients request, I confirm': the coach whose login email is below. CHECK that this is the email you sign in to coaching with.
-- If no account has that email it changes nothing. Every other coach stays on 'I schedule everyone' until they choose.
-- WHAT YOU SHOULD SEE: the first result shows the one coach it will change (one row), the second shows 'request' for that coach.
select u.id as coach_id, u.email from auth.users u where lower(u.email) = 'trainwithronarnold@gmail.com';
begin;
insert into public.coach_booking_policies (coach_id, booking_mode)
select u.id, 'request' from auth.users u where lower(u.email) = 'trainwithronarnold@gmail.com'
on conflict (coach_id) do update set booking_mode = 'request';
commit;
select bp.coach_id, bp.booking_mode from public.coach_booking_policies bp join auth.users u on u.id = bp.coach_id where lower(u.email) = 'trainwithronarnold@gmail.com';
