// 0328: removing a program from a client's profile (programs.archived_at). The copy and everything under it stay; the client can no longer read it; the coach still can; a removed
// program must be inactive (so putting it back never silently makes it the client's current program); putting it back makes it readable again; and logged history is untouched.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0328 a program removed from a client's profile is hidden from the client and kept",
  migrations: ["0324", "0328"],
  phases: {
    async "0328"({ db, h }) {
      const coach = await h.user("AR Coach");
      const ann = await h.user("AR Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "AR group");
      await h.member(group, ann);

      await h.asSuper();
      const existing = await h.one("select count(*)::int as n from public.programs where archived_at is not null");
      h.check("no existing program is removed", existing.n === 0);

      const prog = (await db.query("insert into public.programs (group_id, name, created_by, athlete_id, is_active) values ($1, 'For Ann', $2, $3, true) returning id", [group, coach, ann])).rows[0].id;
      const w = (await db.query("insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day 1', 1, 1) returning id", [prog, group])).rows[0].id;
      const e = (await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order, tracked_fields) values ($1, $2, 'Squat', 0, array['reps']) returning id", [w, group])).rows[0].id;
      await db.query("insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps) values ($1, 0, '5')", [e]);

      const counts = async () =>
        h.one(
          `select (select count(*) from public.programs where id = $1)::int as programs,
                  (select count(*) from public.workouts where program_id = $1)::int as workouts,
                  (select count(*) from public.group_workout_exercises where workout_id = $2)::int as exercises,
                  (select count(*) from public.group_workout_exercise_sets where group_workout_exercise_id = $3)::int as sets`,
          [prog, w, e]
        );

      await h.as(ann);
      const before = await counts();
      h.check("before it is removed the client reads the program and everything under it", Object.values(before).every((n) => n === 1), JSON.stringify(before));

      // A removed program must be inactive.
      await h.as(coach);
      const stillActive = await tryQ(db, "update public.programs set archived_at = now() where id = $1", [prog]);
      h.check("removing an ACTIVE program in one step is refused (it must be made inactive in the same update)", !!stillActive.error, JSON.stringify(stillActive));
      const removed = await tryQ(db, "update public.programs set archived_at = now(), is_active = false where id = $1 returning id", [prog]);
      h.check("the coach removes it (inactive and removed together)", !removed.error && removed.rows.length === 1, JSON.stringify(removed));
      const reactivate = await tryQ(db, "update public.programs set is_active = true where id = $1", [prog]);
      h.check("a removed program cannot be made active while it is removed", !!reactivate.error, JSON.stringify(reactivate));

      // The client no longer sees it or anything under it; the coach still does.
      await h.as(ann);
      const asClient = await counts();
      h.check("the client can no longer read the program or anything under it", Object.values(asClient).every((n) => n === 0), JSON.stringify(asClient));
      await h.as(coach);
      const asCoach = await counts();
      h.check("the coach still reads all of it", Object.values(asCoach).every((n) => n === 1), JSON.stringify(asCoach));

      // Logged history is untouched.
      await h.asSuper();
      const sess = (await db.query("insert into public.athlete_sessions (athlete_id, group_id, workout_id, status) values ($1, $2, $3, 'completed') returning id", [ann, group, w]).catch(() => ({ rows: [{ id: null }] }))).rows[0].id;
      if (sess) {
        const log = await tryQ(db, "insert into public.workout_logs (session_id, athlete_id, group_id, workout_id, total_volume, total_sets_completed, new_prs) values ($1, $2, $3, $4, 100, 3, '{}') returning id", [sess, ann, group, w]);
        h.check("a logged session on a removed program is still there", !log.error, JSON.stringify(log));
      }
      const logs = await h.one("select count(*)::int as n from public.workout_logs where workout_id = $1", [w]);
      h.check("removing a program deleted no logs", logs.n === (sess ? 1 : 0));

      // The client cannot remove or put back a program.
      await h.as(ann);
      const clientWrite = await tryQ(db, "update public.programs set archived_at = null where id = $1 returning id", [prog]);
      h.check("a client cannot put a removed program back", !!clientWrite.error || (clientWrite.rows ?? []).length === 0, JSON.stringify(clientWrite));

      // Put back: visible again, still inactive until the coach makes it active.
      await h.as(coach);
      const back = await tryQ(db, "update public.programs set archived_at = null where id = $1 returning is_active", [prog]);
      h.check("the coach puts it back; it stays inactive", !back.error && back.rows[0].is_active === false, JSON.stringify(back));
      await h.as(ann);
      const afterBack = await counts();
      h.check("after it is put back the client can read it again", Object.values(afterBack).every((n) => n === 1), JSON.stringify(afterBack));
    },
  },
};
