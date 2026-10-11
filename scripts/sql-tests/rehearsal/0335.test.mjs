// 0335: assigning a program that belongs to no client yet to ONE client attaches it to that client (no copy, nothing left in the library); every other case copies as before.
export default {
  name: "0335 assign a no-client program to one client: attach, else copy",
  migrations: ["0335"],
  phases: {
    async "0335"({ db, h }) {
      const coach = await h.user("AM Coach");
      const will = await h.user("AM Will");
      const ann = await h.user("AM Ann");
      const bea = await h.user("AM Bea");
      const stranger = await h.user("AM Stranger");
      const org = await h.org(coach);
      const solo = await h.group(org, coach, "one_on_one", "AM solo Will");
      const annSolo = await h.group(org, coach, "one_on_one", "AM solo Ann");
      const team = await h.group(org, coach, "team", "AM team");
      await h.member(solo, will);
      await h.member(annSolo, ann);
      await h.member(team, bea);
      const otherCoach = await h.user("AM Other Coach");
      const otherOrg = await h.org(otherCoach);
      const otherGroup = await h.group(otherOrg, otherCoach, "team", "AM other team");
      await h.member(otherGroup, stranger);

      await h.asSuper();
      async function build(group, name, opts = {}) {
        const prog = (await db.query(`insert into public.programs (group_id, name, created_by, athlete_id, is_active, ai_draft) values ($1, $2, $3, $4, $5, $6) returning id`, [group, name, coach, opts.athlete ?? null, opts.active ?? true, opts.draft ?? false])).rows[0].id;
        const w = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index, athlete_id) values ($1, $2, 'Day 1', 1, $3) returning id`, [prog, group, opts.athlete ?? null])).rows[0].id;
        const e = (await db.query(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order, tracked_fields, athlete_id) values ($1, $2, 'Squat', 0, array['reps'], $3) returning id`, [w, group, opts.athlete ?? null])).rows[0].id;
        await db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps) values ($1, 0, '5')`, [e]);
        await db.query(`insert into public.workout_notes (workout_id, group_id, body, position, created_by, athlete_id) values ($1, $2, 'n', 0, $3, $4)`, [w, group, coach, opts.athlete ?? null]);
        await db.query(`insert into public.exercise_progressions (program_id, group_id, exercise_name, model, config, created_by) values ($1, $2, 'Squat', 'linear', '{}'::jsonb, $3)`, [prog, group, coach]);
        return { prog, w, e };
      }
      const counts = async (p) => h.one(`select (select group_id from public.programs where id = $1) as g, (select athlete_id from public.programs where id = $1) as a, (select is_active from public.programs where id = $1) as active,
        (select count(*) from public.workouts where program_id = $1 and group_id = $2 and athlete_id = $3)::int as w,
        (select count(*) from public.group_workout_exercises where workout_id = $4 and group_id = $2 and athlete_id = $3)::int as e,
        (select count(*) from public.workout_notes where workout_id = $4 and group_id = $2 and athlete_id = $3)::int as n,
        (select count(*) from public.exercise_progressions where program_id = $1 and group_id = $2)::int as pr,
        (select count(*) from public.group_workout_exercise_sets where group_workout_exercise_id = $5)::int as s`, [p.prog, p.dest, p.who, p.w, p.e]);
      const programCount = async () => (await h.one(`select count(*)::int as n from public.programs`)).n;

      // 1. a template in a one-on-one space (no client on it, nobody has used it) is ATTACHED to Will in his own space: no copy is made
      // (a no-client program in a one-on-one space can no longer be created since 0333; an existing one is simulated by switching that guard off for the insert)
      await db.query("alter table public.programs disable trigger programs_guard_one_on_one");
      const tpl = await build(annSolo, "Template for anyone");
      await db.query("alter table public.programs enable trigger programs_guard_one_on_one");
      await h.asSuper();
      const before = await programCount();
      await h.as(coach);
      const att = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Will', null)`, [tpl.prog, solo, will]);
      h.check("a no-client template is attached, not copied", att.was_attached === true && att.assigned_program_id === tpl.prog, JSON.stringify(att));
      await h.asSuper();
      const c1 = await counts({ prog: tpl.prog, dest: solo, who: will, w: tpl.w, e: tpl.e });
      h.check("it moved into Will's space with Will's id on the program, its workouts, exercises, notes and progression, and it is active", c1.g === solo && c1.a === will && c1.active === true && c1.w === 1 && c1.e === 1 && c1.n === 1 && c1.pr === 1 && c1.s === 1, JSON.stringify(c1));
      h.check("no copy was made, nothing is left in the library", (await programCount()) === before);
      const notice = await h.one(`select count(*)::int as n from public.notifications where profile_id = $1 and type = 'program_assigned' and link_path like '%' || $2`, [will, tpl.prog]);
      h.check("Will is sent the usual assigned notice", notice.n === 1, String(notice.n));
      await h.as(will);
      const seen = await h.rows(`select id from public.programs where id = $1`, [tpl.prog]);
      h.check("Will can read it (it is his program)", seen.length === 1);

      // 2. a program that already belongs to a client is COPIED to the new client; the original stays with its owner
      await h.as(coach);
      const copy1 = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Ann', null)`, [tpl.prog, annSolo, ann]);
      h.check("a program that already belongs to a client is copied, not stolen", copy1.was_attached === false && copy1.assigned_program_id !== tpl.prog);
      await h.asSuper();
      h.check("the original stays with Will", (await h.one(`select athlete_id as a from public.programs where id = $1`, [tpl.prog])).a === will);

      // 3. a team's active shared program is COPIED (the team keeps it)
      const shared = await build(team, "Team program", { active: true });
      await h.as(coach);
      const copy2 = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Will', null)`, [shared.prog, solo, will]);
      h.check("a team's active shared program is copied; the team keeps it", copy2.was_attached === false);
      await h.asSuper();
      h.check("the shared program is untouched", (await h.one(`select group_id as g, athlete_id as a, is_active as active from public.programs where id = $1`, [shared.prog])).g === team);

      // 4. an inactive library program in a team group (approved draft) with no history is ATTACHED to one client
      const lib = await build(team, "Library program", { active: false });
      await h.as(coach);
      const att2 = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Will', '2026-12-01')`, [lib.prog, solo, will]);
      h.check("an inactive team library program is attached to the one client", att2.was_attached === true && att2.assigned_program_id === lib.prog);
      await h.asSuper();
      const c4 = await counts({ prog: lib.prog, dest: solo, who: will, w: lib.w, e: lib.e });
      h.check("...moved with its workouts, exercises, notes and progression, active, with the new start date", c4.g === solo && c4.a === will && c4.active === true && c4.w === 1 && c4.e === 1 && c4.n === 1 && c4.pr === 1);
      h.check("the start date was set", String((await h.one(`select start_date::text as d from public.programs where id = $1`, [lib.prog])).d) === "2026-12-01");

      // 5. a program someone has logged against is COPIED (its history stays with it)
      const used = await build(team, "Used program", { active: false });
      await db.query(`insert into public.athlete_sessions (workout_id, athlete_id, group_id) values ($1, $2, $3)`, [used.w, bea, team]);
      await h.as(coach);
      const copy3 = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Will', null)`, [used.prog, solo, will]);
      h.check("a program someone has started is copied, never moved", copy3.was_attached === false);

      // 6. an unsigned AI draft is never attached (it is copied, still a draft)
      const draft = await build(team, "AI draft program", { active: false, draft: true });
      await h.as(coach);
      const copy4 = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Will', null)`, [draft.prog, solo, will]);
      h.check("an unsigned AI draft is copied (and stays a draft), never attached", copy4.was_attached === false);
      await h.asSuper();
      h.check("the copy of a draft is still a draft and not active", (await h.one(`select ai_draft as d, is_active as a from public.programs where id = $1`, [copy4.assigned_program_id])).d === true);

      // 6b. the program a coach package hands to each buyer is COPIED, never turned into one client's personal program
      const pkgProg = await build(team, "Package program", { active: false });
      await db.query(`insert into public.coach_packages (coach_id, group_id, name, sessions_per_week, billing_type, sessions_granted, rate_cents, default_program_id) values ($1, $2, 'Pkg', 1, 'one_time', 4, 1000, $3)`, [coach, team, pkgProg.prog]);
      await h.as(coach);
      const copy5 = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Will', null)`, [pkgProg.prog, solo, will]);
      h.check("a program a coach package depends on is copied, not attached", copy5.was_attached === false);

      // 6c. a client must be an athlete in the destination group
      await h.as(coach);
      await h.expectError("a client who is not in the destination group is refused", () => db.query(`select * from public.assign_program_to_client($1, $2, $3, 'Nobody', null)`, [lib.prog, solo, bea]), /not in that group/i);

      // 7. a coach of another organization cannot attach or copy this program
      await h.asSuper();
      const lib2 = await build(team, "Guarded library", { active: false });
      await h.as(otherCoach);
      let refused = false;
      try {
        const r = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Stranger', null)`, [lib2.prog, otherGroup, stranger]);
        refused = !r || !r.assigned_program_id;
      } catch {
        refused = true;
      }
      h.check("a coach of another organization cannot take this program", refused);
      await h.asSuper();
      h.check("the guarded program did not move", (await h.one(`select group_id as g from public.programs where id = $1`, [lib2.prog])).g === team);

      // 8. permissions of the function itself
      const acl = await h.one(`select has_function_privilege('anon', 'public.assign_program_to_client(uuid, uuid, uuid, text, date)', 'execute') as a, has_function_privilege('authenticated', 'public.assign_program_to_client(uuid, uuid, uuid, text, date)', 'execute') as b`);
      h.check("signed-in coaches can use it, visitors cannot", acl.a === false && acl.b === true);
    },
  },
};
