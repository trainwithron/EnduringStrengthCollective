-- Realtime DELETE payloads only carry the columns in a table's replica
-- identity (primary key, by default) — so a DELETE on comments/reactions
-- arrived with only `id`, never `post_id`, making it impossible for a
-- listening client to know which post's count to decrement. Comments now
-- has a real delete feature (inline comment section); reactions already
-- had this same gap, silently guarded against rather than fixed. Full
-- replica identity is a metadata-only change — no data risk.
alter table public.comments replica identity full;
alter table public.reactions replica identity full;
