// 0359: weights from a history import (the FitPros import: sessions stamped noon, 00 minutes, 17 to 19 seconds) do not set training maxes. Live sets and the older history entries
// (the coach's quick entry and spreadsheet import, stamped 12:00:00) still do.
export default {
  name: "0359 imported FitPros sets do not set training maxes",
  migrations: ["0359"],
  phases: {
    async "0359"({ db, h }) {
      const coach = await h.user("TM Coach");
      const client = await h.user("TM Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "TM team");
      await h.member(group, client);
      await h.asSuper();

      const session = async (startedAt, historical, exercise) => {
        const s = (await db.query(`insert into public.athlete_sessions (group_id, athlete_id, status, is_historical, started_at, completed_at) values ($1, $2, 'completed', $3, $4, $4) returning id`, [group, client, historical, startedAt])).rows[0].id;
        return (await db.query(`insert into public.session_exercises (session_id, exercise_name, exercise_order, is_added) values ($1, $2, 0, true) returning id`, [s, exercise])).rows[0].id;
      };
      const addSet = (exerciseId, weight, reps) =>
        db.query(`insert into public.set_logs (session_exercise_id, set_order, weight, reps, status, completed_at) values ($1, 0, $2, $3, 'completed', now())`, [exerciseId, weight, reps]);
      const maxOf = async (exercise) => (await db.query(`select estimated_max from public.athlete_training_maxes where athlete_id = $1 and exercise_name = $2`, [client, exercise])).rows[0]?.estimated_max ?? null;

      // A live set sets a max.
      await addSet(await session("2026-10-01T09:30:00Z", false, "TM Squat"), 200, 5);
      h.check("a live set sets a training max", (await maxOf("TM Squat")) != null);
      const before = Number(await maxOf("TM Squat"));

      // An imported set (17 to 19 seconds at noon) does not.
      await addSet(await session("2026-08-17T12:00:17Z", true, "TM Squat"), 400, 5);
      await addSet(await session("2026-08-18T12:00:19Z", true, "TM Bench"), 300, 5);
      h.check("an imported set does not raise an existing max", Number(await maxOf("TM Squat")) === before);
      h.check("an imported set does not create a max", (await maxOf("TM Bench")) === null);

      // The older history entries (12:00:00) still do.
      await addSet(await session("2026-08-19T12:00:00Z", true, "TM Deadlift"), 300, 5);
      h.check("the coach's quick-entry and spreadsheet history (12:00:00) still sets a max", (await maxOf("TM Deadlift")) != null);
      // Another historical time is not mistaken for an import.
      await addSet(await session("2026-08-20T09:15:18Z", true, "TM Row"), 200, 5);
      h.check("a historical entry at another time still sets a max", (await maxOf("TM Row")) != null);
    },
  },
};
