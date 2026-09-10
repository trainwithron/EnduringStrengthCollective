-- A label for sorting/filtering the coach's group list (GroupSwitcher,
-- Add Client) into three kinds — not an access-control dimension, so no
-- RLS changes: every existing policy keyed off group membership/coachship
-- is untouched, and every existing group defaults to 'team' (today's
-- traditional shared-program model), behaving exactly as before.
--   'one_on_one' — a single client, usually with their own personal program.
--   'social'     — purely a community/feed for camaraderie; no shared workout.
--   'team'       — the classic "everyone runs the same program" group.
alter table public.groups
  add column group_kind text not null default 'team'
  check (group_kind in ('one_on_one', 'social', 'team'));
