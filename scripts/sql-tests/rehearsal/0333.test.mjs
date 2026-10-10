// 0333: a one-on-one space keeps being one. A program made there has to be FOR its client (a new one with no client is filled in with the space's one client, or refused),
// group-only features (events, invite links, team games, practice schedules, stat categories) are refused there, the space cannot be switched to another kind, and moving a
// client into a one-on-one space that already has its client says so plainly. A team group is unchanged. Programs already there (even with no client) can still be edited.
export default {
  name: "0333 a one-on-one space stays a one-on-one space",
  migrations: ["0333"],
  phases: {
    async "0333"({ db, h }) {
      const coach = await h.user("AK Coach");
      const will = await h.user("AK Will");
      const ann = await h.user("AK Ann");
      const bea = await h.user("AK Bea");
      const org = await h.org(coach);
      const solo = await h.group(org, coach, "one_on_one", "AK solo");
      const empty = await h.group(org, coach, "one_on_one", "AK empty solo");
      const team = await h.group(org, coach, "team", "AK team");
      await h.member(solo, will);
      await h.member(team, ann);
      await h.member(team, bea);

      await h.asSuper();
      const prog = (group, athlete, name) => db.query(`insert into public.programs (group_id, name, created_by, athlete_id) values ($1, $2, $3, $4) returning id, athlete_id`, [group, name, coach, athlete]);

      // PROGRAMS
      const filled = (await prog(solo, null, "No client given")).rows[0];
      h.check("a new program in a one-on-one space with no client is filled in with the space's one client", filled.athlete_id === will, String(filled.athlete_id));
      await h.expectError("a new program with no client in a one-on-one space that has no client is refused", () => prog(empty, null, "Nobody here"), /has to be made for that client/i);
      await h.expectError("a program for someone who is not that space's client is refused", () => prog(solo, ann, "Wrong person"), /has to be made for that client/i);
      const own = (await prog(solo, will, "Will's own")).rows[0];
      h.check("a program for the space's own client is accepted as given", own.athlete_id === will);
      const teamShared = (await prog(team, null, "Team shared")).rows[0];
      h.check("a team group is unchanged: a program with no client stays shared", teamShared.athlete_id === null);

      // A no-client program that was already in a one-on-one space (made before this rule) is left alone and stays editable.
      await db.query(`alter table public.programs disable trigger programs_guard_one_on_one`);
      const legacy = (await prog(solo, null, "Legacy template")).rows[0];
      await db.query(`alter table public.programs enable trigger programs_guard_one_on_one`);
      h.check("(setup) a legacy no-client program exists in the one-on-one space", legacy.athlete_id === null);
      await h.as(coach);
      const renamed = await h.rows(`update public.programs set name = 'Legacy template (renamed)' where id = $1 returning name`, [legacy.id]);
      h.check("an existing no-client program in a one-on-one space can still be renamed", renamed.length === 1);
      const deleted = await h.rows(`delete from public.programs where id = $1 returning id`, [(await (async () => { await h.asSuper(); return (await prog(team, null, "to delete")).rows[0].id; })())]);
      h.check("(sanity) a coach can still delete a program", deleted.length === 1);
      await h.as(coach);
      await h.expectError("pointing a program at someone who is not the space's client is refused", () => db.query(`update public.programs set athlete_id = $1 where id = $2`, [ann, legacy.id]), /has to be made for that client/i);

      // GROUP-ONLY FEATURES
      await h.asSuper();
      const event = (group) => db.query(`insert into public.group_sessions (coach_id, title, start_at, end_at, kind, group_id) values ($1, 'Event', now() + interval '1 day', now() + interval '1 day 1 hour', 'event', $2)`, [coach, group]);
      await h.expectError("a group event cannot be added to a one-on-one space", () => event(solo), /not available in a client's own space/i);
      await event(team);
      h.check("a group event can still be added to a team group", true);
      const invite = (group, code) => db.query(`insert into public.group_invites (group_id, code, created_by) values ($1, $2, $3)`, [group, code, coach]);
      await h.expectError("an invite link cannot be added to a one-on-one space", () => invite(solo, "ak-solo"), /not available in a client's own space/i);
      await invite(team, "ak-team");
      h.check("an invite link can still be added to a team group", true);
      const game = (group) => db.query(`insert into public.team_games (group_id, event_date, opponent, created_by) values ($1, current_date, 'Rivals', $2)`, [group, coach]);
      await h.expectError("a team game cannot be added to a one-on-one space", () => game(solo), /not available in a client's own space/i);
      await game(team);
      h.check("a team game can still be added to a team group", true);
      const practice = (group) => db.query(`insert into public.team_practice_schedules (group_id, weekday, start_time, end_time, created_by) values ($1, 2, '16:00', '17:00', $2)`, [group, coach]);
      await h.expectError("a practice schedule cannot be added to a one-on-one space", () => practice(solo), /not available in a client's own space/i);
      await practice(team);
      h.check("a practice schedule can still be added to a team group", true);
      const stat = (group) => db.query(`insert into public.group_stat_fields (group_id, name) values ($1, 'Tackles')`, [group]);
      await h.expectError("a stat category cannot be added to a one-on-one space", () => stat(solo), /not available in a client's own space/i);
      await stat(team);
      h.check("a stat category can still be added to a team group", true);

      // THE SPACE STAYS ONE-ON-ONE
      await h.as(coach);
      await h.expectError("a one-on-one space cannot be switched to another kind", () => db.query(`update public.groups set group_kind = 'team' where id = $1`, [solo]), /stays a one-on-one space/i);
      const toSocial = await h.rows(`update public.groups set group_kind = 'social' where id = $1 returning group_kind`, [team]);
      h.check("a team group can still be switched to another kind", toSocial.length === 1 && toSocial[0].group_kind === "social");

      // MOVING A CLIENT IN
      await h.expectError("moving a client into a one-on-one space that already has its client says so plainly", () => db.query(`select public.move_client_to_group($1, $2, $3)`, [ann, team, solo]), /holds one client/i);
      await db.query(`select public.move_client_to_group($1, $2, $3)`, [ann, team, empty]);
      const moved = await h.rows(`select group_id from public.group_memberships where profile_id = $1 and role = 'athlete'`, [ann]);
      h.check("moving a client into an empty one-on-one space still works", moved.length === 1 && moved[0].group_id === empty);

      await h.asSuper();
      const acl = await h.one(`select (has_function_privilege('anon', 'public.one_on_one_athlete(uuid)', 'execute') or has_function_privilege('authenticated', 'public.one_on_one_athlete(uuid)', 'execute')) as a, has_function_privilege('authenticated', 'public.guard_one_on_one_program()', 'execute') as b`);
      h.check("the helper is not callable by visitors or signed-in users, and the trigger functions are not callable by signed-in users", acl.a === false && acl.b === false);
      const untouched = await h.one(`select count(*)::int as n from public.programs where id = $1`, [legacy.id]);
      h.check("nothing was deleted: the legacy program is still there", untouched.n === 1);
    },
  },
};
