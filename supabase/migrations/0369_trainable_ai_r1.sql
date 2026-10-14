-- Release BY: the AI you can train. A correction the coach makes ("no barbell squats, his back") becomes a RULE that applies only to clients it fits (the fit is worked out invisibly from the coach's notes on
-- the client, the AI build notes, level and age band, and the reason given), and a short list of Past AI build notes is kept for each client.
--
--   * client_ai_notes: per client, at most eight short dated bullets of the important facts the coach has told the AI (the AI writes and merges them; the coach can edit or delete any), and the coach's own raw
--     words for 30 days. Coach-private; the client never reads it; deleted with the client.
--   * coach_learned_rules gets the other kinds of rule (avoid / prefer / rest / day length / implement / named exercise) next to the existing swap, the context it is for (when_keys), the sentence the AI is
--     told (then_text), how far it reaches (all clients / clients with that context / one client), how many times the coach confirmed it, and where it came from. A rule with no from/to is allowed.
--   * coach_edit_events can record a correction with its context and reason.
--   * coach_learning_settings remembers that the one-time explanation of how the AI learns was shown.
-- Everything stays private to the coach (own rows only). Existing rules and events are untouched. Re-runnable.

create table if not exists public.client_ai_notes (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  -- [{ "text": "can't rotate: maximize rotation elsewhere", "date": "2026-10-14", "tags": ["no_rotation"] }]: at most 8, about 8 words each.
  bullets jsonb not null default '[]'::jsonb,
  -- [{ "text": "...", "at": "2026-10-14T12:00:00Z" }]: the coach's own words, kept 30 days, for the coach's own view only.
  raw jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (coach_id, athlete_id)
);
create index if not exists client_ai_notes_athlete_idx on public.client_ai_notes (athlete_id);
alter table public.client_ai_notes enable row level security;
revoke all on public.client_ai_notes from anon;
drop policy if exists "client_ai_notes_own_coach" on public.client_ai_notes;
-- The policy names the coach and a group the coach coaches: the client never reads their notes, another coach never does.
create policy "client_ai_notes_own_coach" on public.client_ai_notes for all to authenticated
  using (coach_id = (select auth.uid()) and public.is_group_coach(group_id))
  with check (coach_id = (select auth.uid()) and public.is_group_coach(group_id));

alter table public.coach_learned_rules drop constraint if exists coach_learned_rules_kind_check;
alter table public.coach_learned_rules add constraint coach_learned_rules_kind_check
  check (kind in ('swap', 'avoid', 'prefer', 'rest', 'day_length', 'implement', 'named'));
alter table public.coach_learned_rules alter column from_name drop not null;
alter table public.coach_learned_rules alter column to_name drop not null;
alter table public.coach_learned_rules
  add column if not exists when_keys text[] not null default '{}',
  add column if not exists then_text text,
  add column if not exists scope text not null default 'all',
  add column if not exists client_id uuid references public.profiles(id) on delete cascade,
  add column if not exists source text,
  add column if not exists confirmations int not null default 0;
alter table public.coach_learned_rules drop constraint if exists coach_learned_rules_scope_check;
alter table public.coach_learned_rules add constraint coach_learned_rules_scope_check check (scope in ('all', 'context', 'client'));

alter table public.coach_edit_events drop constraint if exists coach_edit_events_kind_check;
alter table public.coach_edit_events add constraint coach_edit_events_kind_check
  check (kind in ('swap', 'sets_reps', 'order', 'removed', 'added', 'correction'));
alter table public.coach_edit_events
  add column if not exists context jsonb,
  add column if not exists why text,
  add column if not exists reason_tags text[],
  add column if not exists source text;

alter table public.coach_learning_settings add column if not exists intro_seen_at timestamptz;
