-- equipment_qr_decal_scoping_sept19.md — a QR sticker on gym equipment
-- deep-links into /scan/[exerciseId] with no login required. A walk-in
-- (not a client of that exercise's coach) sees a public landing page
-- with the exercise video and a real, standalone lead-capture "join
-- this gym's community" form — deliberately NOT wired into the
-- (unbuilt) org Calendar Spotter trainer-dispatch's own future intake
-- page (org_calendar_spotter_trainer_dispatch_scoping_sept19.md); that
-- feature doesn't exist yet, and this table is a real, complete,
-- standalone capture on its own that a later dispatch feature could
-- read from, not something this build needs to wait on.
create table public.gym_visitor_leads (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  exercise_library_id uuid references public.exercise_library(id) on delete set null,
  full_name text not null,
  contact_info text not null,
  note text,
  created_at timestamptz not null default now()
);
create index gym_visitor_leads_organization_id_idx on public.gym_visitor_leads(organization_id);

alter table public.gym_visitor_leads enable row level security;

-- Org owner/admin reads their own org's leads. No anon SELECT at all —
-- a visitor's name/contact info must never be publicly readable, same
-- trust model as discovery_bookings (migration 0089).
create policy "gym_visitor_leads_select_org_owner_admin" on public.gym_visitor_leads for select
  to authenticated using (
    exists (
      select 1 from public.organization_memberships om
      where om.organization_id = gym_visitor_leads.organization_id
        and om.profile_id = (select auth.uid())
        and om.role = any (array['owner'::org_member_role, 'admin'::org_member_role])
    )
  );

-- Same shape as book_discovery_call (0089): a security-definer RPC is
-- the only way in for an anonymous visitor, doing its own validation —
-- no anon INSERT policy needed on the table itself.
create or replace function public.submit_gym_visitor_lead(
  p_organization_id uuid,
  p_exercise_library_id uuid,
  p_full_name text,
  p_contact_info text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
begin
  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'name is required';
  end if;
  if p_contact_info is null or btrim(p_contact_info) = '' then
    raise exception 'contact info is required';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization not found';
  end if;

  insert into public.gym_visitor_leads (
    organization_id, exercise_library_id, full_name, contact_info, note
  ) values (
    p_organization_id,
    p_exercise_library_id,
    btrim(p_full_name),
    btrim(p_contact_info),
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_lead_id;

  return v_lead_id;
end;
$$;

grant execute on function public.submit_gym_visitor_lead(uuid, uuid, text, text, text) to anon, authenticated;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead'
  ));

-- Notifies every owner/admin of the org the moment a real lead comes
-- in — same security-definer-trigger shape already used for comments/
-- video uploads (e.g. 0073_notify_on_comment_reply.sql), just with no
-- group_id (notifications.group_id has been nullable since the
-- training-partner-matching migration, for exactly this kind of
-- cross-group/org-level notification).
create or replace function public.notify_on_gym_visitor_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org_name text;
  v_recipient record;
begin
  select name into v_org_name from public.organizations where id = new.organization_id;
  for v_recipient in
    select profile_id from public.organization_memberships
    where organization_id = new.organization_id and role in ('owner', 'admin')
  loop
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (
      v_recipient.profile_id,
      null,
      'gym_visitor_lead',
      new.full_name || ' is interested in joining ' || coalesce(v_org_name, 'your gym') || ' — scanned an equipment QR code',
      '/dashboard'
    );
  end loop;
  return new;
end;
$$;

create trigger trg_notify_on_gym_visitor_lead
  after insert on public.gym_visitor_leads
  for each row execute function public.notify_on_gym_visitor_lead();
