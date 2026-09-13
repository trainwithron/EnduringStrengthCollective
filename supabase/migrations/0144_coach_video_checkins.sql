-- Coach video check-ins (coach_video_checkin_idea memory) — the mirror
-- image of the already-shipped athlete video feedback loop (that one:
-- client submits video, coach comments; this one: coach records a
-- check-in, AI turns the coach's own rough notes into a summary +
-- action items). Real technical caveat carried over from scoping: full
-- audio transcription isn't a proven input shape for this app's AI
-- integration (proven text-in/text-out only) — so the AI step takes the
-- coach's typed notes, not the video's audio, as its input. The video
-- itself is for the athlete to watch, not for the AI to process.
create table public.coach_video_checkins (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  video_path text not null,
  coach_notes text not null default '',
  ai_summary text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index coach_video_checkins_athlete_idx on public.coach_video_checkins(athlete_id);
create index coach_video_checkins_group_idx on public.coach_video_checkins(group_id);

-- Action items live in their own table, not a jsonb column on the
-- check-in itself, specifically so the athlete can toggle completion
-- without needing write access to the coach's own notes/summary —
-- reuses the existing habit-checklist UI shape/pattern, per the
-- original scoping.
create table public.coach_video_checkin_action_items (
  id uuid primary key default uuid_generate_v4(),
  checkin_id uuid not null references public.coach_video_checkins(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  completed boolean not null default false,
  sort_order int not null default 0
);
create index coach_video_checkin_action_items_checkin_idx on public.coach_video_checkin_action_items(checkin_id);

alter table public.coach_video_checkins enable row level security;
create policy "video_checkins_select_own_or_coach" on public.coach_video_checkins for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "video_checkins_write_coach" on public.coach_video_checkins for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));

alter table public.coach_video_checkin_action_items enable row level security;
create policy "video_checkin_actions_select_own_or_coach" on public.coach_video_checkin_action_items for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "video_checkin_actions_insert_coach" on public.coach_video_checkin_action_items for insert
  to authenticated with check (public.is_group_coach(group_id));
-- Athlete can check items off (the whole point of a real action list);
-- same "RLS gates ownership, not arithmetic" trust level already
-- accepted elsewhere in this app (e.g. session_credits self-update) —
-- a forged edit to the item's own text isn't a real incentive anyone
-- has a reason to exploit.
create policy "video_checkin_actions_update_own_or_coach" on public.coach_video_checkin_action_items for update
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id))
  with check (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "video_checkin_actions_delete_coach" on public.coach_video_checkin_action_items for delete
  to authenticated using (public.is_group_coach(group_id));

-- Storage: private bucket, same {group_id}/{athlete_id}/{uuid}.{ext}
-- convention as athlete-exercise-videos (0115).
insert into storage.buckets (id, name, public, file_size_limit)
values ('coach-video-checkins', 'coach-video-checkins', false, 209715200) -- private, 200MB cap
on conflict (id) do nothing;

create policy "coach_video_checkins_select_members"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'coach-video-checkins'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy "coach_video_checkins_insert_coach"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'coach-video-checkins'
    and public.is_group_coach((storage.foldername(name))[1]::uuid)
  );

create policy "coach_video_checkins_delete_coach"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'coach-video-checkins'
    and public.is_group_coach((storage.foldername(name))[1]::uuid)
  );
