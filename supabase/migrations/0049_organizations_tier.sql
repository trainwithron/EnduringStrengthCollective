-- Phase 1 of the ESN roadmap: the tenant tier above `groups`. Per the
-- design sketch, this is additive — the only change to any existing
-- table is `groups.organization_id`. Branding (button shape + colors +
-- fonts) moves from per-coach (`coach_preferences`) to per-organization,
-- since a real org shares one visual identity across every coach in it.

create type public.org_member_role as enum ('owner', 'admin', 'coach');

create table public.organizations (
  id uuid primary key default uuid_generate_v4(),
  slug text not null unique,
  name text not null,
  display_name text,
  logo_url text,
  button_shape text not null default 'sharp'
    check (button_shape in ('sharp', 'rounded', 'pill')),
  accent_color text not null default '#C4622D',
  background_color text not null default '#1C1B1A',
  text_color text not null default '#EDE8E0',
  font_display text not null default 'Barlow Condensed'
    check (font_display in ('Barlow Condensed', 'Oswald', 'Bebas Neue', 'Anton')),
  font_body text not null default 'Inter'
    check (font_body in ('Inter', 'Roboto', 'Work Sans', 'Nunito Sans')),
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.org_member_role not null default 'coach',
  created_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);

alter table public.profiles add column is_platform_admin boolean not null default false;

create or replace function public.is_org_member(target_org_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships
    where organization_id = target_org_id and profile_id = auth.uid()
  );
$$;

alter table public.organizations enable row level security;

create policy "organizations_select_member" on public.organizations for select
  to authenticated using (public.is_org_member(id));

create policy "organizations_update_owner" on public.organizations for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

alter table public.organization_memberships enable row level security;

create policy "org_memberships_select_own_org" on public.organization_memberships for select
  to authenticated using (public.is_org_member(organization_id));

create policy "org_memberships_manage_owner" on public.organization_memberships for all
  to authenticated
  using (exists (
    select 1 from public.organizations o
    where o.id = organization_id and o.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.organizations o
    where o.id = organization_id and o.owner_id = auth.uid()
  ));

alter table public.groups add column organization_id uuid references public.organizations(id) on delete cascade;

-- Real backfill: onboard the user's own operation as org #1 (Enduring
-- Strength Co.), carry today's per-coach branding forward as the org's
-- starting branding, add every existing coach as a member, and point
-- every existing group at it.
do $$
declare
  v_owner_id uuid;
  v_org_id uuid;
  v_shape text;
  v_accent text;
  v_bg text;
  v_text text;
  v_font_display text;
  v_font_body text;
begin
  -- profiles has no email column (that lives on auth.users); resolve the
  -- real owner by email first, falling back to the known display name.
  -- Deliberately NOT falling back to "earliest coach by joined_at" — the
  -- seeded test account (Jordan Coach) actually joined before the real
  -- user's own account in this environment, so that heuristic would pick
  -- the wrong owner.
  select id into v_owner_id from auth.users where email = 'trainwithronarnold@gmail.com';
  if v_owner_id is null then
    select id into v_owner_id from public.profiles where full_name = 'Coach Ron';
  end if;
  if v_owner_id is null then
    raise exception 'organizations_tier migration: could not resolve the real owner account';
  end if;

  select button_shape, accent_color, background_color, text_color, font_display, font_body
    into v_shape, v_accent, v_bg, v_text, v_font_display, v_font_body
    from public.coach_preferences
    where coach_id = v_owner_id;

  insert into public.organizations (
    slug, name, owner_id, button_shape, accent_color, background_color, text_color, font_display, font_body
  ) values (
    'enduring-strength-co',
    'Enduring Strength Co.',
    v_owner_id,
    coalesce(v_shape, 'sharp'),
    coalesce(v_accent, '#C4622D'),
    coalesce(v_bg, '#1C1B1A'),
    coalesce(v_text, '#EDE8E0'),
    coalesce(v_font_display, 'Barlow Condensed'),
    coalesce(v_font_body, 'Inter')
  )
  returning id into v_org_id;

  update public.profiles set is_platform_admin = true where id = v_owner_id;

  insert into public.organization_memberships (organization_id, profile_id, role)
  select v_org_id, gm.profile_id,
    case when gm.profile_id = v_owner_id then 'owner' else 'coach' end::public.org_member_role
  from (select distinct profile_id from public.group_memberships where role = 'coach') gm
  on conflict (organization_id, profile_id) do nothing;

  update public.groups set organization_id = v_org_id where organization_id is null;
end $$;

alter table public.groups alter column organization_id set not null;

-- Branding now lives on `organizations`, not per-coach.
alter table public.coach_preferences
  drop column button_shape,
  drop column accent_color,
  drop column background_color,
  drop column text_color,
  drop column font_display,
  drop column font_body;
