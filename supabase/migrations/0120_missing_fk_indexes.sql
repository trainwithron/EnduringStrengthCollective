-- Pre-launch performance-advisor pass: unindexed foreign keys flagged
-- by the Supabase linter, purely additive, zero behavior change.
create index if not exists coach_dismissed_reply_alerts_post_id_idx on public.coach_dismissed_reply_alerts(post_id);
create index if not exists exercise_video_comments_author_id_idx on public.exercise_video_comments(author_id);
create index if not exists exercise_video_comments_group_id_idx on public.exercise_video_comments(group_id);
create index if not exists game_stat_entries_athlete_id_idx on public.game_stat_entries(athlete_id);
create index if not exists game_stat_entries_field_id_idx on public.game_stat_entries(field_id);
create index if not exists group_memberships_coach_position_id_idx on public.group_memberships(coach_position_id);
create index if not exists session_exercise_videos_athlete_id_idx on public.session_exercise_videos(athlete_id);
create index if not exists support_messages_author_id_idx on public.support_messages(author_id);
create index if not exists support_requests_coach_id_idx on public.support_requests(coach_id);
create index if not exists team_games_created_by_idx on public.team_games(created_by);
create index if not exists team_practice_schedules_created_by_idx on public.team_practice_schedules(created_by);
