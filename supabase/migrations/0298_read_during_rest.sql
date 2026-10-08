-- Read during rest, v1 (Ron, Oct 7): while a client rests between sets they can open a short reading (King James, bundled in the app) instead of, or beside, the mini-games.
-- It is ON by default for everyone and one tap turns it off. This migration holds only the switches and the coach's day-by-day choice; the passages themselves live in the
-- app (lib/read-content/), so there is nothing to seed and no cost per use.
--
--  * read_settings: one row per client, readable and writable ONLY by that client (not their coach, not anyone else): faith_track (default true; a client's own off always
--    wins) and note_seen_at (the one-time "what is this" note). No row means "on, note not yet seen".
--  * coach_preferences.faith_track_default (default true): a coach turns Read off for ALL their clients; when a coach of the client's group has it off, Read is not offered at
--    all (it is hidden, not greyed out).
--  * read_passage_overrides: a coach picks the passage for a day (reference only, e.g. 'Psalm 23:1-4'); only that coach reads or writes their rows. The app shows the
--    chosen passage to that coach's clients that day if the reference is one of the bundled passages.
--  * read_track_for_me(group, date): what the signed-in client's screen needs, in one call: whether Read is on for them in this group (their own switch AND every coach of
--    the group), the coach's passage for that day if any, and whether they have seen the note. Only a member of the group can ask, and only about themselves.
-- Nothing here changes any existing function or table row.

alter table public.coach_preferences
  add column if not exists faith_track_default boolean not null default true;

create table if not exists public.read_settings (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  faith_track boolean not null default true,
  note_seen_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.read_settings enable row level security;
drop policy if exists "read_settings_select_own" on public.read_settings;
create policy "read_settings_select_own" on public.read_settings for select to authenticated using (athlete_id = (select auth.uid()));
drop policy if exists "read_settings_insert_own" on public.read_settings;
create policy "read_settings_insert_own" on public.read_settings for insert to authenticated with check (athlete_id = (select auth.uid()));
drop policy if exists "read_settings_update_own" on public.read_settings;
create policy "read_settings_update_own" on public.read_settings for update to authenticated
  using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));
drop policy if exists "read_settings_delete_own" on public.read_settings;
create policy "read_settings_delete_own" on public.read_settings for delete to authenticated using (athlete_id = (select auth.uid()));
revoke all on public.read_settings from anon;

create table if not exists public.read_passage_overrides (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  override_date date not null,
  reference text not null check (char_length(btrim(reference)) between 3 and 80),
  created_at timestamptz not null default now(),
  unique (coach_id, override_date)
);
alter table public.read_passage_overrides enable row level security;
drop policy if exists "read_passage_overrides_own" on public.read_passage_overrides;
create policy "read_passage_overrides_own" on public.read_passage_overrides for all to authenticated
  using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
revoke all on public.read_passage_overrides from anon;

create or replace function public.read_track_for_me(p_group_id uuid, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_coach_off boolean;
  v_own_on boolean;
  v_note_seen boolean;
  v_override text;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.group_memberships gm where gm.group_id = p_group_id and gm.profile_id = v_me) then
    raise exception 'not authorized';
  end if;

  -- Hidden when any coach of this group has turned Read off for their clients.
  select exists (
    select 1 from public.group_memberships gm
    join public.coach_preferences cp on cp.coach_id = gm.profile_id
    where gm.group_id = p_group_id and gm.role = 'coach' and cp.faith_track_default = false
  ) into v_coach_off;

  select coalesce((select rs.faith_track from public.read_settings rs where rs.athlete_id = v_me), true) into v_own_on;
  select coalesce((select rs.note_seen_at is not null from public.read_settings rs where rs.athlete_id = v_me), false) into v_note_seen;

  if p_date is not null then
    select o.reference into v_override
    from public.read_passage_overrides o
    join public.group_memberships gm on gm.profile_id = o.coach_id and gm.group_id = p_group_id and gm.role = 'coach'
    where o.override_date = p_date
    order by o.created_at
    limit 1;
  end if;

  return jsonb_build_object(
    'enabled', (not coalesce(v_coach_off, false)) and v_own_on,
    'override_reference', v_override,
    'note_seen', coalesce(v_note_seen, false)
  );
end;
$function$;

revoke all on function public.read_track_for_me(uuid, date) from public, anon;
grant execute on function public.read_track_for_me(uuid, date) to authenticated, service_role;
