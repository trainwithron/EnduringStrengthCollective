-- A 5th Feed channel, "Team Chat" — the group-chat half of the
-- Coach<->Athlete messaging scoping (athlete_social_dm_video_chat_scoping
-- memory). Reuses the existing channels system verbatim: same realtime
-- subscription, same posting/composer UI, same RLS shape already proven
-- across the other 4 channels — this is a config addition, not new
-- infrastructure. Framed as more conversational/casual in copy/placement
-- only; structurally identical to General.
alter table public.posts drop constraint posts_channel_check;
alter table public.posts add constraint posts_channel_check
  check (channel in ('announcements', 'form_checks', 'pr_board', 'general', 'team_chat'));
