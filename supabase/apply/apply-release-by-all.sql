-- RELEASE BY (THE AI YOU CAN TRAIN, FIRST RELEASE: CLAUSES ON A CLIENT, RULES THAT APPLY ONLY TO THE CLIENTS THEY FIT; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 119 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 119: Nothing changes on screen until the code that goes with it is live. Then a correction typed while the AI builder is paused offers, once, to remember it for the clients it fits, a client's profile lists their clauses, and what the AI has learned shows under What I've learned about how you coach. Existing learned swaps keep working. Run it BEFORE the code.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BY (the AI you can train, first release: clauses on a client, rules that apply only to the clients they fit; run BEFORE the code that goes with it is live), step 119: 0369 The AI you can train, first release: clauses on a client (what we program around), rules the coach teaches that apply only to clients with the clauses they are for, corrections recorded with their reason, and the one-time note about how the AI learns
do $g119$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0369 is not already applied (no clauses table yet)', to_regclass('public.client_clauses') is null),
      ('the Stage 2 learning tables exist', to_regclass('public.coach_learned_rules') is not null and to_regclass('public.coach_edit_events') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BY (the AI you can train, first release: clauses on a client, rules that apply only to the clients they fit; run BEFORE the code that goes with it is live), step 119 (0369) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g119$;

-- ====================================================================================================
-- migration 0369_trainable_ai_r1.sql
-- ====================================================================================================

-- Release BY: the AI you can train, first release. A correction the coach makes ("no barbell squats, his back") becomes a RULE that applies only to clients it fits, and what a client needs programmed around
-- is written on the client as CLAUSES.
--
--   * client_clauses: a named thing to program around on one client ("Back limits", "No rotation", "Limited overhead range"). Coach-private; the coach adds and removes them. A learned rule says WHEN a
--     client has certain clauses THEN do this. Only the clause name is kept here, never medical text.
--   * coach_learned_rules gets the other kinds of rule (avoid / prefer / rest / day length / implement / named exercise) next to the existing swap, the clauses it is for (when_keys), the sentence the AI is
--     told (then_text), how far it reaches (all clients / clients with those clauses / one client), how many times the coach confirmed it, and where it came from. A rule with no from/to is allowed.
--   * coach_edit_events can record a correction with its context and reason.
--   * coach_learning_settings remembers that the one-time explanation of how the AI learns was shown.
-- Everything stays private to the coach (own rows only). Existing rules and events are untouched. Re-runnable.

create table if not exists public.client_clauses (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (coach_id, athlete_id, key)
);
create index if not exists client_clauses_athlete_idx on public.client_clauses (athlete_id, coach_id);
alter table public.client_clauses enable row level security;
revoke all on public.client_clauses from anon;
drop policy if exists "client_clauses_own_coach" on public.client_clauses;
-- The policy names the coach and the group the coach coaches, so another organization's coach can never read a clause.
create policy "client_clauses_own_coach" on public.client_clauses for all to authenticated
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
alter table public.coach_learned_rules add constraint coach_learned_rules_scope_check check (scope in ('all', 'clauses', 'client'));

alter table public.coach_edit_events drop constraint if exists coach_edit_events_kind_check;
alter table public.coach_edit_events add constraint coach_edit_events_kind_check
  check (kind in ('swap', 'sets_reps', 'order', 'removed', 'added', 'correction'));
alter table public.coach_edit_events
  add column if not exists context jsonb,
  add column if not exists why text,
  add column if not exists reason_tags text[],
  add column if not exists source text;

alter table public.coach_learning_settings add column if not exists intro_seen_at timestamptz;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 119 (0369)' as step, '0369 The AI you can train' as what, not ((to_regclass('public.client_clauses') is null)) as in_place
) as result order by step;
