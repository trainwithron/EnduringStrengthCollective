-- Release S, part 4: "Hide exercise demos" follows the PERSON, not the device (Ron: a client who turns demos off should not have to do it again on every phone and computer).
--
-- Until now the choice lived only in the browser. This adds one tiny private table, one row per client, holding that switch (and room for other personal display switches later):
--   * client_ui_settings(athlete_id, hide_demos, updated_at): readable and writable ONLY by that client (not their coach, not anyone else), exactly like read_settings (0298).
--     It is deliberately NOT a column on read_settings: a row there means "this client made a reading choice", and a coach's own default for the reading would be overridden
--     the moment a row existed for some other reason.
--   * Nothing is deleted or changed in any existing table. A client who has not used the switch has no row and sees demos as before. The app keeps the old on-this-device value
--     until the person next flips the switch (then it is saved here too), so nobody loses their current choice. Removing the account removes the row with it.
-- New object only. Re-runnable.

create table if not exists public.client_ui_settings (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  hide_demos boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.client_ui_settings enable row level security;
drop policy if exists "client_ui_settings_select_own" on public.client_ui_settings;
create policy "client_ui_settings_select_own" on public.client_ui_settings for select to authenticated using (athlete_id = (select auth.uid()));
drop policy if exists "client_ui_settings_insert_own" on public.client_ui_settings;
create policy "client_ui_settings_insert_own" on public.client_ui_settings for insert to authenticated with check (athlete_id = (select auth.uid()));
drop policy if exists "client_ui_settings_update_own" on public.client_ui_settings;
create policy "client_ui_settings_update_own" on public.client_ui_settings for update to authenticated
  using (athlete_id = (select auth.uid())) with check (athlete_id = (select auth.uid()));
drop policy if exists "client_ui_settings_delete_own" on public.client_ui_settings;
create policy "client_ui_settings_delete_own" on public.client_ui_settings for delete to authenticated using (athlete_id = (select auth.uid()));
revoke all on public.client_ui_settings from anon;
-- Row policies do not govern TRUNCATE, REFERENCES or TRIGGER; no client path needs them.
revoke truncate, references, trigger on public.client_ui_settings from authenticated;
