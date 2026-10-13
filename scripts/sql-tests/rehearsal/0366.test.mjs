// 0366: template slots survive Duplicate, and a program that still has a slot cannot be given to a client.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0366 template slots survive duplicate; a client is never given a slot",
  migrations: ["0365", "0366"],
  phases: {
    async "0366"({ db, h }) {
      const coach = await h.user("TS Coach");
      const client = await h.user("TS Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "TS team");
      await h.member(group, client);
      await h.asSuper();

      const mk = async (name, withSlot) => {
        const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, $2, $3) returning id`, [group, name, coach])).rows[0].id;
        const w = (await db.query(`insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day 1', 1, 1) returning id`, [prog, group])).rows[0].id;
        const ex = (await db.query(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order, is_slot, slot_side, slot_tier) values ($1, $2, $3, 0, $4, $5, $6) returning id`,
          [w, group, withSlot ? "Slot: Hinge · Unilateral · Class A" : "Back Squat", withSlot, withSlot ? "unilateral" : null, withSlot ? "A" : null])).rows[0].id;
        await db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps) values ($1, 0, '8')`, [ex]);
        return prog;
      };
      const template = await mk("TS template", true);
      const plain = await mk("TS plain", false);

      const copy = (await db.query(`select public.duplicate_program($1, $2, $3, null, null, null) as id`, [template, group, coach])).rows[0].id;
      const slotCopy = (await db.query(`select e.is_slot, e.slot_side, e.slot_tier from public.group_workout_exercises e join public.workouts w on w.id = e.workout_id where w.program_id = $1`, [copy])).rows[0];
      h.check("a plain duplicate of a template keeps the slot, its side and its class", slotCopy?.is_slot === true && slotCopy.slot_side === "unilateral" && slotCopy.slot_tier === "A");

      const refused = await msg(db, `select public.duplicate_program($1, $2, $3, $4, null, null)`, [template, group, coach, client]);
      h.check("a copy for a client of a program with a slot is refused, with the plain message", refused.includes("This template has slots"));
      const made = (await db.query(`select count(*)::int as n from public.programs where athlete_id = $1`, [client])).rows[0].n;
      h.check("and nothing was created for the client", made === 0);

      // The attach path (an unused library program handed straight to a client) must not take a slot either.
      await h.as(coach);
      const attach = await msg(db, `select * from public.assign_program_to_client($1, $2, $3, null, null)`, [template, group, client]);
      await h.asSuper();
      h.check("assign_program_to_client refuses a program with a slot too", attach.includes("This template has slots"));
      const stillLibrary = (await db.query(`select athlete_id from public.programs where id = $1`, [template])).rows[0];
      h.check("and the template stays a library program", stillLibrary.athlete_id === null);

      const ok = await msg(db, `select public.duplicate_program($1, $2, $3, $4, null, null)`, [plain, group, coach, client]);
      h.check("a program with no slot is still given to a client as before", ok === "");
      const real = (await db.query(`select e.is_slot, e.exercise_name from public.group_workout_exercises e join public.workouts w on w.id = e.workout_id join public.programs p on p.id = w.program_id where p.athlete_id = $1`, [client])).rows[0];
      h.check("the client's copy has the real exercise and no slot", real?.is_slot === false && real.exercise_name === "Back Squat");
    },
  },
};
