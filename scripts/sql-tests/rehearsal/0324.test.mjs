// 0324: AI builder drafts. A program the AI builds is a draft (ai_draft) and can never be active until signed off; signing off is one update; a copy of a draft is a draft; the copy of a
// signed-off program is active exactly as before; existing programs are untouched.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0324 AI drafts cannot go live until signed off",
  migrations: ["0324"],
  phases: {
    async "0324"({ db, h }) {
      const coach = await h.user("AD Coach");
      const ann = await h.user("AD Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "AD group");
      await h.member(group, ann);

      await h.asSuper();
      const existing = await h.rows("select count(*)::int as n from public.programs where ai_draft is true");
      h.check("no existing program is a draft", existing[0].n === 0);

      // A coach saves an AI draft: inactive is fine, active is refused.
      await h.as(coach);
      const draft = (await h.one("insert into public.programs (group_id, name, created_by, is_active, ai_draft) values ($1, 'AI draft', $2, false, true) returning id", [group, coach])).id;
      h.check("a draft can be saved inactive", !!draft);
      const bad = await tryQ(db, "insert into public.programs (group_id, name, created_by, is_active, ai_draft) values ($1, 'AI live', $2, true, true)", [group, coach]);
      h.check("a draft cannot be created active", !!bad.error && /signed off/.test(bad.error), JSON.stringify(bad));
      const toggled = await tryQ(db, "update public.programs set is_active = true where id = $1", [draft]);
      h.check("the Active toggle cannot make an unsigned draft live", !!toggled.error && /signed off/.test(toggled.error), JSON.stringify(toggled));
      await h.asSuper();
      const still = await h.one("select is_active, ai_draft from public.programs where id = $1", [draft]);
      h.check("...and the draft is unchanged", still.is_active === false && still.ai_draft === true);

      // A copy of a draft is a draft, and is never live.
      await h.as(coach);
      const copy = (await h.one("select public.duplicate_program($1, $2, $3, $4, 'Ann') as id", [draft, group, coach, ann])).id;
      await h.asSuper();
      const c = await h.one("select is_active, ai_draft from public.programs where id = $1", [copy]);
      h.check("assigning a draft to a client makes a draft copy that is NOT active", c.ai_draft === true && c.is_active === false, JSON.stringify(c));

      // Sign-off: one update.
      await h.as(coach);
      const signed = await tryQ(db, "update public.programs set ai_draft = false, is_active = true where id = $1 returning id", [draft]);
      h.check("signing off (one update) makes it active", !signed.error && signed.rows.length === 1, JSON.stringify(signed));
      await h.asSuper();
      const s2 = await h.one("select is_active, ai_draft from public.programs where id = $1", [draft]);
      h.check("it is active and no longer a draft", s2.is_active === true && s2.ai_draft === false);

      // A copy of a signed-off program is live, exactly as before.
      await h.as(coach);
      const copy2 = (await h.one("select public.duplicate_program($1, $2, $3, $4, 'Ann') as id", [draft, group, coach, ann])).id;
      await h.asSuper();
      const c2 = await h.one("select is_active, ai_draft from public.programs where id = $1", [copy2]);
      h.check("a copy of a signed-off program is active, as before", c2.is_active === true && c2.ai_draft === false, JSON.stringify(c2));

      // An ordinary program is unaffected.
      await h.as(coach);
      const plain = await tryQ(db, "insert into public.programs (group_id, name, created_by) values ($1, 'Plain', $2) returning is_active, ai_draft", [group, coach]);
      h.check("an ordinary new program is active and not a draft, as before", plain.rows?.[0]?.is_active === true && plain.rows[0].ai_draft === false, JSON.stringify(plain));

      // The guard function is not callable by users.
      await h.asSuper();
      const open = await h.one("select has_function_privilege('authenticated', 'public.guard_ai_draft_not_active()', 'execute') as a, has_function_privilege('anon', 'public.guard_ai_draft_not_active()', 'execute') as b");
      h.check("the guard function cannot be run by a signed-in user or a visitor", open.a === false && open.b === false);

      // The database itself hides an unsigned draft, and everything under it, from the client it was built for.
      await h.asSuper();
      const d3 = (await db.query("insert into public.programs (group_id, name, created_by, athlete_id, is_active, ai_draft) values ($1, 'AI for Ann', $2, $3, false, true) returning id", [group, coach, ann])).rows[0].id;
      const w3 = (await db.query("insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day 1', 1, 1) returning id", [d3, group])).rows[0].id;
      const e3 = (await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order, tracked_fields) values ($1, $2, 'Squat', 0, array['reps']) returning id", [w3, group])).rows[0].id;
      await db.query("insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps) values ($1, 0, '5')", [e3]);
      await db.query("insert into public.workout_notes (workout_id, group_id, body, position, created_by) values ($1, $2, 'note', 0, $3)", [w3, group, coach]);
      await db.query("insert into public.exercise_progressions (program_id, group_id, exercise_name, model, config, created_by) values ($1, $2, 'Squat', 'linear', '{}'::jsonb, $3)", [d3, group, coach]).catch(() => null);
      const counts = async () =>
        h.one(
          `select (select count(*) from public.programs where id = $1)::int as programs,
                  (select count(*) from public.workouts where program_id = $1)::int as workouts,
                  (select count(*) from public.group_workout_exercises where workout_id = $2)::int as exercises,
                  (select count(*) from public.group_workout_exercise_sets where group_workout_exercise_id = $3)::int as sets,
                  (select count(*) from public.workout_notes where workout_id = $2)::int as notes,
                  (select count(*) from public.exercise_progressions where program_id = $1)::int as progressions`,
          [d3, w3, e3]
        );
      await h.as(ann);
      const asClient = await counts();
      h.check("the client the draft was built for cannot read the draft program or anything under it", Object.values(asClient).every((n) => n === 0), JSON.stringify(asClient));
      await h.as(coach);
      const asCoach = await counts();
      h.check("the coach of the group reads all of it", asCoach.programs === 1 && asCoach.workouts === 1 && asCoach.exercises === 1 && asCoach.sets === 1 && asCoach.notes === 1, JSON.stringify(asCoach));
      const copyOfDraft = await tryQ(db, "select public.duplicate_program($1, $2, $3, $4, 'Ann') as id", [d3, group, coach, ann]);
      h.check("the coach can still copy and assign a draft", !!copyOfDraft.rows?.[0]?.id, JSON.stringify(copyOfDraft));
      h.check("...and the copy has everything under it", ((await h.one("select count(*)::int as n from public.group_workout_exercises where workout_id in (select id from public.workouts where program_id = $1)", [copyOfDraft.rows[0].id])).n) === 1);
      await h.as(coach);
      await db.query("update public.programs set ai_draft = false, is_active = true where id = $1", [d3]);
      await h.as(ann);
      const afterSignOff = await counts();
      h.check("after sign-off the client reads the program and everything under it", afterSignOff.programs === 1 && afterSignOff.workouts === 1 && afterSignOff.exercises === 1 && afterSignOff.sets === 1 && afterSignOff.notes === 1, JSON.stringify(afterSignOff));

      // A client cannot change a draft.
      await h.as(ann);
      const write = await tryQ(db, "update public.programs set ai_draft = false, is_active = true where id = $1 returning id", [copy]);
      h.check("a client cannot sign off a draft", !!write.error || (write.rows ?? []).length === 0, JSON.stringify(write));
    },
  },
};
