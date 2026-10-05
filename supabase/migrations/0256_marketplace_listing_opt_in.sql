-- Public coach listing is opt-in. Until now /find-a-coach listed any organization with a coach who had even one program,
-- so a new coach (or a test org) could appear publicly without ever choosing to. Now an organization is listed only after its
-- owner or admin turns it on, and every existing organization starts off.
alter table public.organizations
  add column if not exists listed_in_marketplace boolean not null default false;
