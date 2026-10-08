-- Release O fix: notify_on_target_change() (0306, already applied on the live database before its revoke was added) is closed to the public and signed-in users like the other
-- internal functions. It is a trigger function, so it could never be called as a function by anyone, but internal functions are server-only on purpose. The trigger keeps firing
-- (the right to run a trigger function is checked when the trigger is created, not when it fires). Re-runnable; changes no data.
revoke all on function public.notify_on_target_change() from public, anon, authenticated;
