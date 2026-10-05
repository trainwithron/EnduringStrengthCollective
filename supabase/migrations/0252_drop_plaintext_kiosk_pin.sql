-- Remove the plain-text kiosk PIN column. APPLY THIS AFTER the new app code is deployed and 0251 is applied:
-- the previous code still reads group_memberships.kiosk_pin, so dropping it before the deploy would break that
-- screen. 0251 has already copied every PIN across hashed.
alter table public.group_memberships drop column if exists kiosk_pin;
