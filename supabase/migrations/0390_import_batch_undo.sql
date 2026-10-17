-- 0390: undo a whole history import. Every workout an import creates carries the same batch id, so "Undo this import" removes exactly that import's entries (and nothing the person logged live).
-- Adds one nullable column and one index. Safe to run before the code that uses it is live.
alter table public.athlete_sessions add column if not exists import_batch_id uuid;
create index if not exists athlete_sessions_import_batch_idx on public.athlete_sessions (import_batch_id) where import_batch_id is not null;
