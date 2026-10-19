// 0419: saving a filled team sheet. Sessions on their real dates, finished the way any workout is, nothing pings an athlete or the feed, one notice for the coach, an athlete's own session kept unless replaced,
// training maxes right whatever order sheets are saved in, and a whole upload taken back.
import { readFileSync } from "node:fs";

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
      h.check("the dates in this test are still inside the two-year window the save allows (move them forward if this fails)", Date.now() < Date.parse("2028-08-01T00:00:00Z"));
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
      const mkWorkout = async (title, _unused, idx) => (await db.query("insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, $3, $4) returning id", [prog, g, title, idx])).rows[0].id;
      const mon = await mkWorkout("Lower A", "2026-10-05", 1);
      const wed = await mkWorkout("Lower B", "2026-10-07", 2);
      const mkEx = async (workout, name, order) => (await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, $3, $4) returning id", [workout, g, name, order])).rows[0].id;
      const monSquat = await mkEx(mon, "Back squat", 1);
      const monBench = await mkEx(mon, "Bench press", 2);
      const wedSquat = await mkEx(wed, "Back squat", 1);
      // another group's workout, to be refused
      const oprog = (await db.query("insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id", [otherGroup, outsider])).rows[0].id;
      const oworkout = (await db.query("insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'X', 1) returning id", [oprog, otherGroup])).rows[0].id;

      h.check("the workouts have no date of their own, as in the live database", (await db.query("select count(*)::int as n from public.workouts where group_id = $1 and scheduled_date is not null", [g])).rows[0].n === 0);

      // Cy already has a session for Monday (their own, done on their phone), and the group's squat record is 200
      const cySession = (await db.query("insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, started_at, completed_at) values ($1, $2, $3, 'completed', '2026-10-05T15:00:00Z', '2026-10-05T16:00:00Z') returning id", [mon, g, cy])).rows[0].id;
      await db.query("insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, achieved_at) values ($1, 'Back squat', 'weight', 'higher_better', 200, $2, '2026-09-01T12:00:00Z')", [g, cy]);

      const row = (athlete, workout, day, exercises) => ({ athlete_id: athlete, workout_id: workout, day, at: `${day}T19:00:00Z`, exercises });
      const sets = (...pairs) => pairs.map(([weight, reps]) => ({ weight, reps }));
      const save = async (who, rows, replace = false, group = g, batch = null, last = true) => {
        await h.as(who);
        const r = await tryQ(db, `select public.team_sheet_save($1, 'xlsx', $2::jsonb, $3, $4, $5) as r`, [group, JSON.stringify(rows), replace, batch, last]);
        await h.asSuper();
        return r.error ? { error: r.error } : r.rows[0].r;
      };

      // ---- who may save
      for (const [who, label] of [[ann, "a client"], [outsider, "a coach of another organization"], [owner, "an organization owner who does not coach this group"]]) {
        const r = await save(who, [row(ann, mon, "2026-10-05", [{ id: monSquat, sets: sets([225, 5]) }])]);
        h.check(label + " cannot save a sheet", /not authorized/.test(r.error ?? ""), JSON.stringify(r));
      }
      await h.as(null);
      let r0 = await tryQ(db, `select public.team_sheet_save($1, 'xlsx', '[]'::jsonb, false)`, [g]);
      h.check("nor can a signed-out visitor", !!r0.error);
      await h.asSuper();

      // ---- a real save, Wednesday listed before Monday on purpose
      const rows = [
        row(ann, wed, "2026-10-07", [{ id: wedSquat, sets: sets([245, 3], [245, 3]) }]),
        row(ann, mon, "2026-10-05", [{ id: monSquat, sets: sets([225, 5], [235, 5], [245, 5]) }, { id: monBench, sets: sets([185, 5], [null, 8]) }]),
        row(bo, mon, "2026-10-05", [{ id: monSquat, sets: sets([300, 5]) }]),
        row(cy, mon, "2026-10-05", [{ id: monSquat, sets: sets([210, 5]) }]),
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
      const annMon = logs.find((l) => l.athlete_id === ann && new Date(l.created_at).toISOString().startsWith("2026-10-05"));
      h.check("the totals are right: 225x5 + 235x5 + 245x5 + 185x5 = 4450 volume over 5 sets (body weight set has no volume)", Number(annMon?.total_volume) === 4450 && annMon?.total_sets_completed === 5, JSON.stringify(annMon));
      const bw = (await db.query(`select sl.weight, sl.reps from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.import_batch_id = $1 and s.athlete_id = $2 and se.exercise_name = 'Bench press' order by sl.set_order`, [batch, ann])).rows;
      h.check("a body-weight set is saved with no weight and its reps", bw.length === 2 && Number(bw[0].weight) === 185 && bw[1].weight === null && bw[1].reps === 8, JSON.stringify(bw));

      // Cy's own session is untouched
      const cyNow = (await db.query(`select id, import_batch_id, completed_at from public.athlete_sessions where workout_id = $1 and athlete_id = $2`, [mon, cy])).rows;
      h.check("Cy's own session is exactly as it was", cyNow.length === 1 && cyNow[0].id === cySession && cyNow[0].import_batch_id === null && new Date(cyNow[0].completed_at).toISOString() === "2026-10-05T16:00:00.000Z");

      // ---- nothing reaches the athletes or the feed; one notice for the coach
      h.check("no feed post was made", (await db.query(`select count(*)::int as n from public.posts where group_id = $1`, [g])).rows[0].n === 0);
      const notes = (await db.query(`select profile_id, type, body, link_path from public.notifications where group_id = $1`, [g])).rows;
      h.check("exactly one notice, to the coach, and none to any athlete", notes.length === 1 && notes[0].profile_id === coach && notes[0].type === "team_sheet_saved", JSON.stringify(notes));
      h.check("it says what was saved and where to undo it", /3 workouts for 2 athletes/.test(notes[0]?.body ?? "") && /undo/i.test(notes[0]?.body ?? "") && notes[0]?.link_path === `/groups/${g}/team-sheet`, JSON.stringify(notes[0]));

      // ---- records: Bo's 300 broke the group's 200 record; Ann's Monday 245 did not beat 300; dated on the real day
      const recs = (await db.query(`select athlete_id, value, achieved_at, superseded_at from public.exercise_records where group_id = $1 and exercise_name = 'Back squat' and tracked_field = 'weight' order by value`, [g])).rows;
      const current = recs.filter((x) => x.superseded_at === null);
      h.check("the group's current squat record is Bo's 300, and there is only one current holder", current.length === 1 && Number(current[0].value) === 300 && current[0].athlete_id === bo, JSON.stringify(recs));
      h.check("it is dated Monday, not the day it was uploaded", new Date(current[0].achieved_at).toISOString().startsWith("2026-10-05"));

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
        row(outsider, mon, "2026-10-05", [{ id: monSquat, sets: sets([100, 5]) }]),
        row(ann, oworkout, "2026-10-05", [{ id: monSquat, sets: sets([100, 5]) }]),
        row(ann, mon, "2099-01-01", [{ id: monSquat, sets: sets([100, 5]) }]),
        row(ann, mon, "2026-10-05", []),
      ]);
      h.check("an athlete not in the group, another group's workout, a day in the future and a row with no exercises are each skipped with a reason", (mixed.skipped ?? []).length === 4 && mixed.saved === 0, JSON.stringify(mixed));
      let bad = await save(coach, [row(bo, wed, "2026-10-07", [{ id: wedSquat, sets: sets([5000, 5]) }])]);
      h.check("an unbelievable weight skips that row with its reason, nothing half-written", bad.saved === 0 && (bad.skipped ?? []).length === 1 && /not believable/.test(bad.skipped[0].why) && (await db.query(`select count(*)::int as n from public.athlete_sessions where athlete_id = $1 and workout_id = $2`, [bo, wed])).rows[0].n === 0, JSON.stringify(bad));
      bad = await save(coach, [row(bo, wed, "2026-10-07", [{ id: monSquat, sets: sets([100, 5]) }])]);
      h.check("an exercise from another workout is ignored, and a row left with nothing is skipped", bad.saved === 0 && (bad.skipped ?? []).length === 1, JSON.stringify(bad));
      bad = await save(coach, []);
      h.check("no rows is refused", /between 1 and 400/.test(bad.error ?? ""), JSON.stringify(bad));

      // ---- replace never deletes a session the athlete logged themselves
      const rep = await save(coach, [row(cy, mon, "2026-10-05", [{ id: monSquat, sets: sets([215, 5]) }])], true);
      h.check("replace keeps the athlete's own session and says why", rep.saved === 0 && rep.replaced === 0 && (rep.skipped ?? []).length === 1 && /kept, not replaced/.test(rep.skipped[0].why), JSON.stringify(rep));
      h.check("the athlete's own session is still there, untouched", (await db.query(`select count(*)::int as n from public.athlete_sessions where id = $1 and import_batch_id is null and status = 'completed'`, [cySession])).rows[0].n === 1);

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
      h.check("the coach sees their uploads", (mine.rows?.[0]?.n ?? 0) >= 1);
      h.check("but nobody writes the table directly", !!direct.error);

      // ---- undo the first upload
      await h.as(coach);
      u = await tryQ(db, `select public.team_sheet_undo($1) as r`, [batch]);
      await h.asSuper();
      h.check("the coach can undo it" + (u.error ? ": " + u.error : ""), !u.error && u.rows[0].r.sessions_removed === 3, JSON.stringify(u));
      h.check("its sessions, sets and workout logs are gone", (await db.query(`select count(*)::int as n from public.athlete_sessions where import_batch_id = $1`, [batch])).rows[0].n === 0 && (await db.query(`select count(*)::int as n from public.workout_logs l where l.athlete_id = $1 and l.created_at < '2026-10-08'`, [ann])).rows[0].n === 0);
      const after = (await db.query(`select athlete_id, value, superseded_at from public.exercise_records where group_id = $1 and exercise_name = 'Back squat' and tracked_field = 'weight' and superseded_at is null`, [g])).rows;
      h.check("the group's squat record is the 200 it replaced, current again, and Bo's 300 is gone", after.length === 1 && Number(after[0].value) === 200, JSON.stringify(after));
      h.check("Ann's training max for squat is gone with her only sets", (await db.query(`select count(*)::int as n from public.athlete_training_maxes where athlete_id = $1 and exercise_name = 'Back squat'`, [ann])).rows[0].n === 0);
      h.check("the upload is marked undone", (await db.query(`select undone_at from public.team_sheet_batches where id = $1`, [batch])).rows[0].undone_at !== null);
      await h.as(coach);
      u = await tryQ(db, `select public.team_sheet_undo($1)`, [batch]);
      await h.asSuper();
      h.check("undoing it twice is refused", !!u.error && /already undone/.test(u.error), JSON.stringify(u));

      // ---- the rows the APP builds (the fixture the app's own tests check) are accepted by the function, as written
      const fx = JSON.parse(readFileSync(new URL("../fixtures/team-sheet-save-rows.json", import.meta.url), "utf8"));
      const fxMon = await mkWorkout("Fixture Monday", "2026-10-05", 11);
      const fxWed = await mkWorkout("Fixture Wednesday", "2026-10-07", 12);
      const ids = {
        "@ANN": ann,
        "@BO": bo,
        "@CY": cy,
        "@WORKOUT_MON": fxMon,
        "@WORKOUT_WED": fxWed,
        "@EX_SQUAT": await mkEx(fxMon, "Back squat", 1),
        "@EX_BENCH": await mkEx(fxMon, "Bench press", 2),
        "@EX_PULLUP": await mkEx(fxWed, "Pull-up", 1),
        "@EX_PLANK": await mkEx(fxWed, "Plank", 2),
      };
      const fxRows = JSON.parse(JSON.stringify(fx).replace(/"(@[A-Z_]+)"/g, (_m, name) => JSON.stringify(ids[name] ?? name)));
      h.check("the fixture has rows, and every name in it was replaced", fxRows.length > 0 && !JSON.stringify(fxRows).includes("@"), JSON.stringify(fxRows).slice(0, 200));
      const fxRes = await save(coach, fxRows);
      h.check("the function takes the app's rows as they are" + (fxRes.error ? ": " + fxRes.error : ""), !fxRes.error && fxRes.saved === fxRows.length && (fxRes.skipped ?? []).length === 0, JSON.stringify(fxRes));
      const fxSets = (await db.query(`select count(*)::int as n from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.import_batch_id = $1`, [fxRes.batch])).rows[0].n;
      const wantSets = fxRows.reduce((n, r) => n + r.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
      h.check("every set in the fixture was written (" + wantSets + ")", fxSets === wantSets, String(fxSets));
      const fxDates = (await db.query(`select distinct to_char(s.completed_at at time zone 'UTC', 'YYYY-MM-DD') as d from public.athlete_sessions s where s.import_batch_id = $1 order by 1`, [fxRes.batch])).rows.map((x) => x.d);
      h.check("on the days the sheet said", JSON.stringify(fxDates) === JSON.stringify([...new Set(fxRows.map((r) => r.day))].sort()), JSON.stringify(fxDates));

      // ================= the review fixes =================
      const mkAth = async (name) => { const u = await h.user(name); await h.member(g, u); return u; };
      const dee = await mkAth("TS Dee");
      const eve = await mkAth("TS Eve");
      const fay = await mkAth("TS Fay");
      const gus = await mkAth("TS Gus");
      const hal = await mkAth("TS Hal");
      await h.asSuper();
      const xw = await mkWorkout("Extra A", null, 21);
      const xSquat = await mkEx(xw, "Zercher squat", 1);
      const xRow = await mkEx(xw, "Row", 2);
      const xOnlyAnn = (await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Ann only move', 3) returning id", [xw, g])).rows[0].id;
      // (a trigger fills athlete_id from the program on insert, so it is set afterwards)
      await db.query("update public.group_workout_exercises set athlete_id = $1 where id = $2", [ann, xOnlyAnn]);

      // a row for a client who was set aside is skipped, and they stay set aside (saving a sheet must not quietly bring them back)
      await db.query("insert into public.client_inactive (athlete_id, group_id) values ($1, $2)", [eve, g]);
      let res2 = await save(coach, [row(eve, xw, "2026-10-05", [{ id: xSquat, sets: sets([100, 5]) }]), row(dee, xw, "2026-10-05", [{ id: xSquat, sets: sets([300, 3]) }, { id: xRow, sets: sets([135, 8]) }])]);
      h.check("a client who was set aside is skipped with a reason and the other row is saved", res2.saved === 1 && (res2.skipped ?? []).length === 1 && /inactive/.test(res2.skipped[0].why), JSON.stringify(res2));
      h.check("and they are still set aside, with nothing logged about bringing them back", (await db.query("select count(*)::int as n from public.client_inactive where athlete_id = $1 and group_id = $2", [eve, g])).rows[0].n === 1 && (await db.query("select count(*)::int as n from public.client_inactive_events where athlete_id = $1 and group_id = $2 and event = 'brought_back'", [eve, g])).rows[0].n === 0);
      await db.query("delete from public.client_inactive where athlete_id = $1", [eve]);

      // the same athlete and workout twice in one upload: the second is skipped, the count is right
      res2 = await save(coach, [row(fay, xw, "2026-10-05", [{ id: xRow, sets: sets([95, 10]) }]), row(fay, xw, "2026-10-05", [{ id: xRow, sets: sets([95, 10]) }])], true);
      h.check("an athlete listed twice for one workout is saved once, the second skipped with a reason", res2.saved === 1 && res2.replaced === 0 && (res2.skipped ?? []).length === 1 && /twice/.test(res2.skipped[0].why), JSON.stringify(res2));

      // an exercise that is no longer the team's (written for one athlete) is not saved for everyone
      res2 = await save(coach, [row(gus, xw, "2026-10-05", [{ id: xOnlyAnn, sets: sets([50, 5]) }])]);
      h.check("an exercise written for one athlete is refused for the row", res2.saved === 0 && (res2.skipped ?? []).length === 1 && /no longer in that workout/.test(res2.skipped[0].why), JSON.stringify(res2));

      // bad input skips ITS row, not the upload
      res2 = await save(coach, [
        row(gus, xw, "2026-10-05", [{ id: xSquat, sets: sets([100, 8.5]) }]),
        { athlete_id: eve, workout_id: xw, day: "2026-10-05", exercises: [{ id: xSquat, sets: sets([100, 5]) }] },
        row(hal, xw, "2026-10-05", [{ id: xRow, sets: sets([100, 5]) }]),
      ]);
      h.check("fractional reps and a missing time each skip their own row and the good row beside them is saved", res2.saved === 1 && (res2.skipped ?? []).length === 2, JSON.stringify(res2));
      const gusSets = (await db.query("select sl.weight, sl.reps from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.athlete_id = $1 and s.workout_id = $2", [hal, xw])).rows;
      h.check("and it is the good row that was written", gusSets.length === 1 && Number(gusSets[0].weight) === 100 && gusSets[0].reps === 5, JSON.stringify(gusSets));
      res2 = await save(coach, [row(eve, xw, "2026-10-05", [{ id: xSquat, sets: sets([-5, 5]) }, { id: xRow, sets: sets([0, null]) }])]);
      h.check("a negative weight skips the row; a 0 in a weight box is nothing, not a weight", res2.saved === 0 && (res2.skipped ?? []).length === 1, JSON.stringify(res2));
      res2 = await save(coach, [row(eve, xw, "2026-10-05", [{ id: xSquat, sets: sets([0, 5]) }])]);
      const eveSets = (await db.query("select sl.weight, sl.reps from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id join public.athlete_sessions s on s.id = se.session_id where s.athlete_id = $1 and s.workout_id = $2", [eve, xw])).rows;
      h.check("a 0 weight with reps is saved as reps only", res2.saved === 1 && eveSets.length === 1 && eveSets[0].weight === null && eveSets[0].reps === 5, JSON.stringify([res2, eveSets]));

      // replace: a replacement that cannot be written must NOT delete the athlete's session
      const deeBefore = (await db.query("select id from public.athlete_sessions where athlete_id = $1 and workout_id = $2", [dee, xw])).rows;
      res2 = await save(coach, [row(dee, xw, "2026-10-05", [{ id: xSquat, sets: sets([null, null]) }])], true);
      const deeAfter = (await db.query("select id from public.athlete_sessions where athlete_id = $1 and workout_id = $2", [dee, xw])).rows;
      h.check("replacing with an empty row skips it and keeps the existing session (nothing deleted, nothing counted as replaced)", res2.saved === 0 && res2.replaced === 0 && (res2.skipped ?? []).length === 1 && deeBefore.length === 1 && deeAfter.length === 1 && deeAfter[0].id === deeBefore[0].id, JSON.stringify([res2, deeBefore, deeAfter]));
      const zercher = async () => (await db.query("select value, superseded_at, set_log_id from public.exercise_records where group_id = $1 and exercise_name = 'Zercher squat' and tracked_field = 'weight' order by value desc", [g])).rows;
      let z = await zercher();
      h.check("Dee's 300 is the board's Zercher squat holder", z.length === 1 && Number(z[0].value) === 300 && z[0].superseded_at === null, JSON.stringify(z));
      // replace with a corrected number: the old 300 must not stay on the board
      res2 = await save(coach, [row(dee, xw, "2026-10-05", [{ id: xSquat, sets: sets([290, 3]) }])], true);
      z = await zercher();
      h.check("after a replace with 290 the board holds only 290 (the phantom 300 is gone)" + (res2.error ? ": " + res2.error : ""), res2.replaced === 1 && z.length === 1 && Number(z[0].value) === 290 && z[0].superseded_at === null, JSON.stringify([res2, z]));
      const deeMax = (await db.query("select source_weight from public.athlete_training_maxes where athlete_id = $1 and exercise_name = 'Row'", [dee])).rows;
      h.check("and the training max of an exercise the replacement does not have is recomputed (Dee's Row max is gone with the replaced session)", deeMax.length === 0, JSON.stringify(deeMax));

      // what replace may delete: only a finished session a coach logged or that was imported; in progress, booked, paid with a credit and the athlete's own are kept
      const mkSession = async (athlete, extra) => (await db.query("insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, started_at, completed_at, logged_by_coach, is_historical" + (extra.cols ?? "") + ") values ($1, $2, $3, $4, '2026-10-02T15:00:00Z', $5, $6, $7" + (extra.vals ?? "") + ") returning id", [xw, g, athlete, extra.status ?? "completed", extra.status === "in_progress" ? null : "2026-10-02T16:00:00Z", !!extra.coach, !!extra.hist])).rows[0].id;
      const rp1 = await mkAth("TS Rep In Progress");
      const rp2 = await mkAth("TS Rep Imported");
      const rp3 = await mkAth("TS Rep Coach Logged");
      const rp4 = await mkAth("TS Rep Credit");
      await h.asSuper();
      const sInProgress = await mkSession(rp1, { status: "in_progress", coach: true });
      const sImported = await mkSession(rp2, { hist: true });
      const sCoach = await mkSession(rp3, { coach: true });
      const sCredit = await mkSession(rp4, { coach: true, cols: ", deduct_session_credit", vals: ", true" });
      const repAll = await save(coach, [rp1, rp2, rp3, rp4].map((a) => row(a, xw, "2026-10-05", [{ id: xRow, sets: sets([110, 5]) }])), true);
      const left = async (id) => (await db.query("select count(*)::int as n from public.athlete_sessions where id = $1", [id])).rows[0].n;
      h.check("replace swaps a finished coach-logged session and an imported one", repAll.replaced === 2 && repAll.saved === 2 && (await left(sImported)) === 0 && (await left(sCoach)) === 0, JSON.stringify(repAll));
      h.check("and keeps one in progress and one that took a credit, each with its reason", (await left(sInProgress)) === 1 && (await left(sCredit)) === 1 && (repAll.skipped ?? []).length === 2 && repAll.skipped.every((x) => /kept, not replaced/.test(x.why)), JSON.stringify(repAll));
      res2 = await save(coach, [row(rp1, xw, "2026-10-05", [{ id: xRow, sets: sets([110, 5]) }])], false);
      h.check("without replace, an existing session is simply kept", res2.saved === 0 && res2.kept === 1, JSON.stringify(res2));

      // the days a sheet may carry: a real day, not in the future, not more than two years back
      res2 = await save(coach, [
        row(eve, xw, "2023-01-02", [{ id: xRow, sets: sets([100, 5]) }]),
        { athlete_id: eve, workout_id: xw, day: "2026-02-31", at: "2026-03-01T12:00:00Z", exercises: [{ id: xRow, sets: sets([100, 5]) }] },
      ]);
      h.check("a day more than two years back and a day that is not on the calendar are each skipped with a reason, not an error", !res2.error && res2.saved === 0 && (res2.skipped ?? []).length === 2 && /two years/.test(res2.skipped.map((x) => x.why).join(";")), JSON.stringify(res2));

      // undo in the wrong order still leaves the board with a holder
      await db.query("insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, achieved_at) values ($1, 'Safety bar squat', 'weight', 'higher_better', 90, $2, '2026-08-01T12:00:00Z')", [g, fay]);
      const sw1 = await mkWorkout("Extra B", null, 22);
      const sw2 = await mkWorkout("Extra C", null, 23);
      const sbs1 = await mkEx(sw1, "Safety bar squat", 1);
      const sbs2 = await mkEx(sw2, "Safety bar squat", 1);
      const bA = await save(coach, [row(fay, sw1, "2026-10-05", [{ id: sbs1, sets: sets([100, 5]) }])]);
      const bB = await save(coach, [row(gus, sw2, "2026-10-06", [{ id: sbs2, sets: sets([150, 5]) }])]);
      const undoTo = async (b) => { await h.as(coach); const x = await tryQ(db, "select public.team_sheet_undo($1) as r", [b]); await h.asSuper(); return x; };
      const sbsNow = async () => (await db.query("select value from public.exercise_records where group_id = $1 and exercise_name = 'Safety bar squat' and tracked_field = 'weight' and superseded_at is null", [g])).rows;
      h.check("two uploads set 100 then 150", Number((await sbsNow())[0]?.value) === 150 && !!bA.batch && !!bB.batch);
      await undoTo(bA.batch);
      h.check("undoing the OLDER upload first leaves 150 as the holder", Number((await sbsNow())[0]?.value) === 150, JSON.stringify(await sbsNow()));
      await undoTo(bB.batch);
      const sbsAfter = await sbsNow();
      h.check("then undoing the newer one puts back the 90 that was there before, as the holder", sbsAfter.length === 1 && Number(sbsAfter[0].value) === 90, JSON.stringify(sbsAfter));

      // a lower-is-better record comes back by its own direction
      await db.query("insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, achieved_at, superseded_at) values ($1, 'Sprint', 'time_seconds', 'lower_better', 5.2, $2, '2026-08-01T12:00:00Z', now()), ($1, 'Sprint', 'time_seconds', 'lower_better', 6.4, $2, '2026-08-02T12:00:00Z', now())", [g, fay]);
      await db.query("select public.team_sheet_fix_record($1, 'Sprint', 'time_seconds')", [g]);
      const sprint = (await db.query("select value from public.exercise_records where group_id = $1 and exercise_name = 'Sprint' and superseded_at is null", [g])).rows;
      h.check("the best remaining record comes back by its direction (5.2 seconds beats 6.4)", sprint.length === 1 && Number(sprint[0].value) === 5.2, JSON.stringify(sprint));
      await h.as(coach);
      const helperCall = await tryQ(db, "select public.team_sheet_fix_record($1, 'Sprint', 'time_seconds')", [g]);
      await h.asSuper();
      h.check("the helper cannot be called by a signed-in person", !!helperCall.error, JSON.stringify(helperCall));

      // a big upload: 400 rows in one call, timed
      const bigAths = [];
      for (let i = 0; i < 40; i++) bigAths.push(await mkAth("TS Big " + i));
      await h.asSuper();
      const bigW = [];
      const bigE = [];
      for (let i = 0; i < 10; i++) { const w = await mkWorkout("Big " + i, null, 100 + i); bigW.push(w); bigE.push(await mkEx(w, "Big lift " + i, 1)); }
      const bigRows = [];
      for (const a of bigAths) for (let i = 0; i < 10; i++) bigRows.push(row(a, bigW[i], "2026-09-" + String(10 + i).padStart(2, "0"), [{ id: bigE[i], sets: sets([100 + i, 5], [105 + i, 5], [110 + i, 5]) }]));
      bigRows.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0));
      const t0 = Date.now();
      let bigRes = null;
      let bigBatch = null;
      let bigSaved = 0;
      let bigSkipped = 0;
      for (let i = 0; i < bigRows.length; i += 50) {
        const part = bigRows.slice(i, i + 50);
        const last = i + 50 >= bigRows.length;
        bigRes = await save(coach, part, false, g, bigBatch, last);
        if (bigRes.error) break;
        bigBatch = bigRes.batch;
        bigSaved += bigRes.saved;
        bigSkipped += (bigRes.skipped ?? []).length;
      }
      const secs = (Date.now() - t0) / 1000;
      console.log("   400-row team sheet save, in 8 pieces of 50, took " + secs.toFixed(1) + "s");
      h.check("400 rows sent in 8 pieces all save into ONE upload (" + secs.toFixed(1) + "s)" + (bigRes?.error ? ": " + bigRes.error : ""), bigSaved === 400 && bigSkipped === 0 && !!bigBatch && bigRes.total_saved === 400, JSON.stringify(bigRes).slice(0, 200));
      h.check("there is exactly one notice for the whole upload", (await db.query("select count(*)::int as n from public.notifications where group_id = $1 and type = 'team_sheet_saved' and body like 'Team sheet saved: 400 workouts for 40 athletes%'", [g])).rows[0].n === 1);
      h.check("and the upload row carries the totals", JSON.stringify((await db.query("select sessions_saved, athletes_count, first_day::text as f, last_day::text as l from public.team_sheet_batches where id = $1", [bigBatch])).rows[0]) === JSON.stringify({ sessions_saved: 400, athletes_count: 40, f: "2026-09-10", l: "2026-09-19" }));
      // adding to somebody else's upload, or one that is undone, is refused
      const hijack = await save(outsider, [row(bigAths[0], bigW[0], "2026-09-10", [{ id: bigE[0], sets: sets([1, 1]) }])], false, g, bigBatch, true);
      h.check("another person cannot add to an upload", /not authorized|not found/.test(hijack.error ?? ""), JSON.stringify(hijack));
      const finishOnly = await save(coach, [], false, g, bigBatch, true);
      h.check("a finishing call with no rows is allowed for an upload in progress, and adds nothing", !finishOnly.error && finishOnly.saved === 0 && finishOnly.total_saved === 400, JSON.stringify(finishOnly));
      const noBatchEmpty = await save(coach, [], false, g, null, true);
      h.check("no rows without an upload to finish is still refused", /between 1 and 400/.test(noBatchEmpty.error ?? ""), JSON.stringify(noBatchEmpty));
      const bigUndo = await undoTo(bigBatch);
      h.check("and one undo takes all 400 back" + (bigUndo.error ? ": " + bigUndo.error : ""), !bigUndo.error && bigUndo.rows[0].r.sessions_removed === 400, JSON.stringify(bigUndo).slice(0, 200));
    },
  },
};
