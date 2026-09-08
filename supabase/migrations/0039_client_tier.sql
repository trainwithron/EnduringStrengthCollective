-- Distinguishes 1-on-1 in-person clients, online clients, and low-ticket
-- large-group clients — the group tier gets a reduced feature set (no
-- macro programming, since that's not part of what they're paying for).
-- Nullable: an existing/new membership with no tier set behaves exactly
-- as every membership does today (full features), matching this app's
-- usual additive-migration pattern.
alter table public.group_memberships
  add column client_tier text check (client_tier in ('one_on_one', 'online', 'group'));
