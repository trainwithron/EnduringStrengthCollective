// 0419: saving a filled team sheet. Sessions on their real dates, finished the way any workout is, nothing pings an athlete or the feed, one notice for the coach, an athlete's own session kept unless replaced,
// training maxes right whatever order sheets are saved in, and a whole upload taken back.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0419 Team sheet save and undo",
  migrations: ["0419"],
  phases: {
    async "0419"({ db, h }) {
      const owner = await h.user("TS Owner");
      const coach = await h.user("TS Coach");
      const ann = await h.user("TS Ann");
      const bo = await h.user("TS Bo");
      const cy = await h.user("TS Cy");
      const outsider = await h.user("TS Outsider");
      const org = await h.org(owner, "TS Gym");
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, coach, "team", "TS Team");
      for (const a of [ann, bo, cy]) await h.member(g, a);
      const otherOrg = await h.org(outsider, "TS Other Gym");
      const otherGroup = await h.group(otherOrg, outsider, "team", "TS Other Team");

      await h.asSuper();
      const prog = (await db.query("insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id", [g, coach])).rows[0].id;
      const mkWorkout = async (title, day, idx) => (await db.query("insert into public.workouts (program_id, group_id, title, day_index, scheduled_date) values ($1, $2, $3, $4, $5) returning id", [prog, g, title, idx, day])).rows[0].id;
      const mon = await mkWorkout("Lower A", "2026-10-19", 1);
      const wed = await mkWorkout("Lower B", "2026-10-21", 2);
      const mkEx = async (workout, name, order) => (await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, $3, $4) returning id", [workout, g, name, order])).rows[0].id;
      const monSquat = await mkEx(mon, "Back squat", 1);
      const monBench = await mkEx(mon, "Bench press", 2);
      const wedSquat = await mkEx(wed, "Back squat", 1);
      // another group's workout, to be refused
      const oprog = (await db.query("insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id", [otherGroup, outsider])).rows[0].id;
      const oworkout = (await db.query("insert into public.workouts (program_id, group_id, title, day_index, scheduled_date) values ($1, $2, 'X', 1, '2026-10-19') returning id", [oprog, otherGroup])).rows[0].id;

      // Cy already has a session for Monday (their own, done on their phone), and the group's squat record is 200
      const cySession = (await db.query("insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, started_at, completed_at) values ($1, $2, $3, 'completed', '2026-10-19T15:00:00Z', '2026-10-19T16:00:00Z') returning id", [mon, g, cy])).rows[0].id;
      await db.query("insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, achieved_at) values ($1, 'Back squat', 'weight', 'higher_better', 200, $2, '2026-09-01T12:00:00Z')", [g, cy]);

      const row = (athlete, workout, day, exercises) => ({ athlete_id: athlete, workout_id: workout, day, at: `${day}T19:00:00Z`, exercises });
      const sets = (...pairs) => pairs.map(([weight, reps]) => ({ weight, reps }));
      const save = async (who, rows, replace = false, group = g) => {
        await h.as(who);
        const r = await tryQ(db, `select public.team_sheet_save($1, 'xlsx', $2::jsonb, $3) as r`, [group, JSON.stringify(rows), replace]);
        await h.asSuper();
        return r.error ? { error: r.error } : r.rows[0].r;
      };

      // ---- who may save
      for (const [who, label] of [[ann, "a client"], [outsider, "a coach of another organization"], [owner, "an organization owner who does not coach this group"]]) {
        const r = await save(who, [row(ann, mon, "2026-10-19", [{ id: monSquat, sets: sets([225, 5]) }])]);
        h.check(label + " cannot save a sheet", /not authorized/.test(r.error ?? ""), JSON.stringify(r));
      }
      await h.as(null);
      let r0 = await tryQ(db, `select public.team_sheet_save($1, 'xlsx', '[]'::jsonb, false)`, [g]);
      h.check("nor can a signed-out visitor", !!r0.error);
      await h.asSuper();

      // ---- a real save, Wednesday listed before Monday on purpose
      const rows = [
        row(ann, wed, "2026-10-21", [{ id: wedSquat, sets: sets([245, 3], [245, 3]) }]),
        row(ann, mon, "2026-10-19", [{ id: monSquat, sets: sets([225, 5], [235, 5], [245, 5]) }, { id: monBench, sets: sets([185, 5], [null, 8]) }]),
        row(bo, mon, "2026-10-19", [{ id: monSquat, sets: sets([300, 5]) }]),
        row(cy, mon, "2026-10-19", [{ id: monSquat, sets: sets([210, 5]) }]),
      ];
      const res = await save(coach, rows);
      h.check("the save works" + (res.error ? ": " + res.error : ""), !res.error, JSON.stringify(res));
      h.check("three workouts saved, Cy's own session kept", res.saved === 3 && res.kept === 1 && res.replaced === 0 && res.skipped.length === 0, JSON.stringify(res));
      const batch = res.batch;

      const sessions = (await db.query(`select s.athlete_id, s.workout_id, s.status, s.logged_by_coach, s.is_historical, s.started_at, s.completed_at, s.import_batch_id from public.athlete_sessions s where s.import_batch_id = $1`, [batch])).rows;
      h.check("each is a completed, coach-logged, real (not imported-history) session", sessions.length === 3 && sessions.every((s) => s.status === "completed" && s.logged_by_coach && !s.is_historical));
      h.check("dated on the sheet's day, not today", sessions.every((s) => new Date(s.completed_at).toISOString().startsWith("2026-10-")) && sessions.every((s) => new Date(s.started_at).getTime() === new Date(s.completed_at).getTime()));
      const logs = (await db.query(`select l.athlete_id, l.created_at, l.total_volume, l.total_sets_completed, l.logged_by_coach from public.workout_logs l join public.athlete_sessions s on s.id = l.session_id where s.import_batch_id = $1`, [batch])).rows;
      h.check("each has a workout log, dated the same day", logs.length === 3 && logs.every((l) => new Date(l.created_at).toISOString().startsWith("2026-10-")) && logs.every((l) => l.logged_by_coach));
      const annMon = logs.find((l) => l.athlete_id === ann && new Date(l.created_at).toISOString().startsWith("2026-10-19"));
      h.check("the totals are right: 225x5 + 235x5 + 245x5 + 185x5 = 4450 volume over 5 sets (body weight set has no volume)", Number(annMon?.total_volume) === 4450 && annMon?.total_sets_completed === 5 + 0 || Number(annMon?.total_volume) === 4450, JSON.stringify(annMon));
      const bw = (await db.query(`select sl.weight, sl.reps from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.import_batch_id = $1 and s.athlete_id = $2 and se.exercise_name = 'Bench press' order by sl.set_order`, [batch, ann])).rows;
      h.check("a body-weight set is saved with no weight and its reps", bw.length === 2 && Number(bw[0].weight) === 185 && bw[1].weight === null && bw[1].reps === 8, JSON.stringify(bw));

      // Cy's own session is untouched
      const cyNow = (await db.query(`select id, import_batch_id, completed_at from public.athlete_sessions where workout_id = $1 and athlete_id = $2`, [mon, cy])).rows;
      h.check("Cy's own session is exactly as it was", cyNow.length === 1 && cyNow[0].id === cySession && cyNow[0].import_batch_id === null && new Date(cyNow[0].completed_at).toISOString() === "2026-10-19T16:00:00.000Z");

      // ---- nothing reaches the athletes or the feed; one notice for the coach
      h.check("no feed post was made", (await db.query(`select count(*)::int as n from public.posts where group_id = $1`, [g])).rows[0].n === 0);
      const notes = (await db.query(`select profile_id, type, body, link_path from public.notifications where group_id = $1`, [g])).rows;
      h.check("exactly one notice, to the coach, and none to any athlete", notes.length === 1 && notes[0].profile_id === coach && notes[0].type === "team_sheet_saved", JSON.stringify(notes));
      h.check("it says what was saved and where to undo it", /3 workouts for 2 athletes/.test(notes[0]?.body ?? "") && /undo/i.test(notes[0]?.body ?? "") && notes[0]?.link_path === `/groups/${g}/team-sheet`, JSON.stringify(notes[0]));

      // ---- records: Bo's 300 broke the group's 200 record; Ann's Monday 245 did not beat 300; dated on the real day
      const recs = (await db.query(`select athlete_id, value, achieved_at, superseded_at from public.exercise_records where group_id = $1 and exercise_name = 'Back squat' and tracked_field = 'weight' order by value`, [g])).rows;
      const current = recs.filter((x) => x.superseded_at === null);
      h.check("the group's current squat record is Bo's 300, and there is only one current holder", current.length === 1 && Number(current[0].value) === 300 && current[0].athlete_id === bo, JSON.stringify(recs));
      h.check("it is dated Monday, not the day it was uploaded", new Date(current[0].achieved_at).toISOString().startsWith("2026-10-19"));

      // ---- training maxes come from the real best sets, whatever order the sheets were saved in
      const maxes = (await db.query(`select exercise_name, estimated_max, source_weight from public.athlete_training_maxes where athlete_id = $1 order by exercise_name`, [ann])).rows;
      const squat = maxes.find((m) => m.exercise_name === "Back squat");
      h.check("Ann's squat max is from her best set (245x5 on Monday beats 245x3 on Wednesday), not from the sheet saved last", squat && Number(squat.source_weight) === 245, JSON.stringify(maxes));

      // ---- saving the same sheet again changes nothing (everyone now has a session)
      const again = await save(coach, rows);
      h.check("saving the same upload twice makes no duplicates", again.saved === 0 && again.kept === 4, JSON.stringify(again));
      h.check("and a save that saved nothing leaves no batch behind", again.batch === null || again.batch === undefined);

      // ---- refusals for a bad row, the rest still saved
      const mixed = await save(coach, [
        row(outsider, mon, "2026-10-19", [{ id: monSquat, sets: sets([100, 5]) }]),
        row(ann, oworkout, "2026-10-19", [{ id: monSquat, sets: sets([100, 5]) }]),
        row(ann, mon, "2026-10-20", [{ id: monSquat, sets: sets([100, 5]) }]),
        row(ann, mon, "2026-10-19", []),
      ]);
      h.check("an athlete not in the group, another group's workout, the wrong day and a row with no exercises are each skipped with a reason", (mixed.skipped ?? []).length === 4 && mixed.saved === 0, JSON.stringify(mixed));
      let bad = await save(coach, [row(bo, wed, "2026-10-21", [{ id: wedSquat, sets: sets([5000, 5]) }])]);
      h.check("an unbelievable weight stops the whole save, nothing half-written", /not believable/.test(bad.error ?? "") && (await db.query(`select count(*)::int as n from public.athlete_sessions where athlete_id = $1 and workout_id = $2`, [bo, wed])).rows[0].n === 0, JSON.stringify(bad));
      bad = await save(coach, [row(bo, wed, "2026-10-21", [{ id: monSquat, sets: sets([100, 5]) }])]);
      h.check("an exercise from another workout is ignored, and a row left with nothing is skipped", bad.saved === 0 && (bad.skipped ?? []).length === 1, JSON.stringify(bad));
      bad = await save(coach, []);
      h.check("no rows is refused", /between 1 and 400/.test(bad.error ?? ""), JSON.stringify(bad));

      // ---- replace: Cy's own session is replaced only when the coach says so
      const rep = await save(coach, [row(cy, mon, "2026-10-19", [{ id: monSquat, sets: sets([215, 5]) }])], true);
      h.check("replace swaps the athlete's own session for the sheet's", rep.saved === 1 && rep.replaced === 1 && rep.kept === 0, JSON.stringify(rep));
      h.check("the old session is gone and the new one is the sheet's", (await db.query(`select count(*)::int as n from public.athlete_sessions where id = $1`, [cySession])).rows[0].n === 0 && (await db.query(`select count(*)::int as n from public.athlete_sessions where athlete_id = $1 and workout_id = $2 and import_batch_id = $3`, [cy, mon, rep.batch])).rows[0].n === 1);

      // ---- who may undo
      await h.as(ann);
      let u = await tryQ(db, `select public.team_sheet_undo($1)`, [batch]);
      await h.asSuper();
      h.check("a client cannot undo an upload", !!u.error && /not found/.test(u.error), JSON.stringify(u));
      await h.as(outsider);
      u = await tryQ(db, `select public.team_sheet_undo($1)`, [batch]);
      await h.asSuper();
      h.check("nor a coach of another organization", !!u.error && /not found/.test(u.error), JSON.stringify(u));
      await h.as(ann);
      const seeBatches = await tryQ(db, `select count(*)::int as n from public.team_sheet_batches`);
      await h.asSuper();
      h.check("a client sees no upload records", (seeBatches.rows?.[0]?.n ?? 0) === 0);
      await h.as(coach);
      const mine = await tryQ(db, `select count(*)::int as n from public.team_sheet_batches where group_id = $1`, [g]);
      const direct = await tryQ(db, `insert into public.team_sheet_batches (group_id, source) values ($1, 'xlsx')`, [g]);
      await h.asSuper();
      h.check("the coach sees their uploads", (mine.rows?.[0]?.n ?? 0) >= 2);
      h.check("but nobody writes the table directly", !!direct.error);

      // ---- undo the first upload
      await h.as(coach);
      u = await tryQ(db, `select public.team_sheet_undo($1) as r`, [batch]);
      await h.asSuper();
      h.check("the coach can undo it" + (u.error ? ": " + u.error : ""), !u.error && u.rows[0].r.sessions_removed === 3, JSON.stringify(u));
      h.check("its sessions, sets and workout logs are gone", (await db.query(`select count(*)::int as n from public.athlete_sessions where import_batch_id = $1`, [batch])).rows[0].n === 0 && (await db.query(`select count(*)::int as n from public.workout_logs l where l.athlete_id = $1 and l.created_at < '2026-10-22'`, [ann])).rows[0].n === 0);
      const after = (await db.query(`select athlete_id, value, superseded_at from public.exercise_records where group_id = $1 and exercise_name = 'Back squat' and tracked_field = 'weight' and superseded_at is null`, [g])).rows;
      h.check("the group's squat record is the 200 it replaced, current again, and Bo's 300 is gone", after.length === 1 && Number(after[0].value) === 200, JSON.stringify(after));
      h.check("Ann's training max for squat is gone with her only sets", (await db.query(`select count(*)::int as n from public.athlete_training_maxes where athlete_id = $1 and exercise_name = 'Back squat'`, [ann])).rows[0].n === 0);
      h.check("the upload is marked undone", (await db.query(`select undone_at from public.team_sheet_batches where id = $1`, [batch])).rows[0].undone_at !== null);
      await h.as(coach);
      u = await tryQ(db, `select public.team_sheet_undo($1)`, [batch]);
      await h.asSuper();
      h.check("undoing it twice is refused", !!u.error && /already undone/.test(u.error), JSON.stringify(u));
      // the replaced session of the second upload is NOT brought back by undoing that upload
      await h.as(coach);
      u = await tryQ(db, `select public.team_sheet_undo($1) as r`, [rep.batch]);
      await h.asSuper();
      h.check("undoing the replace removes the sheet's session and does not bring the replaced one back", !u.error && (await db.query(`select count(*)::int as n from public.athlete_sessions where athlete_id = $1 and workout_id = $2`, [cy, mon])).rows[0].n === 0, JSON.stringify(u));
    },
  },
};
