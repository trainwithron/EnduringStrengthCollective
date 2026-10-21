// 0430 Allergy auto-rebuild: a system rebuild swaps only the meals of existing days (today on, in that group), keeps a copy, never counts as a try, tells the coach, and cannot be put back.
export default {
  name: "0430 a client's new allergy swaps the clashing options of their plan automatically",
  migrations: ["0430"],
  phases: {
    async "0430"({ db, h }) {
      const coach = await h.user("AR Coach");
      const ann = await h.user("AR Ann");
      const bo = await h.user("AR Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "AR group");
      const other = await h.group(org, coach, "team", "AR other group");
      await h.member(group, ann);
      await h.member(other, bo);

      await h.asSuper();
      const acl = await h.one(
        "select has_function_privilege('service_role', 'public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text)', 'execute') as s, has_function_privilege('authenticated', 'public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text)', 'execute') as a, has_function_privilege('anon', 'public.apply_allergy_rebuild(uuid, uuid, date, jsonb, text)', 'execute') as n, has_function_privilege('authenticated', 'public.restore_meal_plan_try(uuid)', 'execute') as ra"
      );
      h.check("only the server can apply an allergy rebuild; a coach can still run the put-back", acl.s === true && acl.a === false && acl.n === false && acl.ra === true, JSON.stringify(acl));
      h.check("every existing try is a client try (the new column's default)", (await h.one("select count(*)::int as n from public.meal_plan_tries where source <> 'client'")).n === 0);

      const LIB = "Built from the recipe library for the week.";
      const TRY2 = "Rebuilt at the client's request (try 2 of 3).";
      const dayKey = async (offset) => (await h.one("select (current_date + $1::int)::text as d", [offset])).d;
      const d = { past: await dayKey(-1), d0: await dayKey(0), d1: await dayKey(1), d2: await dayKey(2), d5: await dayKey(5) };
      const seed = async (date, rationale, mark) =>
        db.query(
          "insert into public.meal_plans (athlete_id, group_id, log_date, archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals, created_by) values ($1,$2,$3,'omnivore',3,false,false,$4,$5::jsonb,$6::jsonb,$7) on conflict (athlete_id, log_date) do update set rationale = excluded.rationale, macros = excluded.macros, meals = excluded.meals",
          [ann, group, date, rationale, JSON.stringify({ daily: { calories: 2000, protein: 150, carbs: 200, fats: 60 } }), JSON.stringify({ daily: [{ mealId: "m1", mark }] }), coach]
        );
      await seed(d.past, LIB, "old-past");
      await seed(d.d0, TRY2, "peanut-0");
      await seed(d.d1, "Made by hand for this client.", "peanut-hand-1");
      await seed(d.d2, LIB, "fine-2");
      const rows = (dates, mark) => JSON.stringify(dates.map((date) => ({ log_date: date, meals: { daily: [{ mealId: "m1", mark }] } })));
      const NOTICE = "Ann's peanut allergy clashed with their meal plan: 2 days rebuilt automatically.";
      const apply = async (who, grp, dates, mark, notice = NOTICE) => (await h.one("select public.apply_allergy_rebuild($1, $2, current_date, $3::jsonb, $4) as n", [who, grp, rows(dates, mark), notice])).n;
      const stored = async (date) => h.one("select rationale, meals #>> '{daily,0,mark}' as mark, macros #>> '{daily,calories}' as cal, created_by from public.meal_plans where athlete_id = $1 and log_date = $2", [ann, date]);

      const n = await apply(ann, group, [d.d0, d.d1], "safe");
      h.check("both days are changed: a library-built (try) day and a day the coach built by hand", n === 2, String(n));
      const s0 = await stored(d.d0);
      const s1 = await stored(d.d1);
      h.check("only the meals changed: each day keeps its own rationale, macros and author", s0.mark === "safe" && s0.rationale === TRY2 && s0.cal === "2000" && s0.created_by === coach && s1.mark === "safe" && s1.rationale === "Made by hand for this client.", JSON.stringify([s0, s1]));
      h.check("a day not in the rebuild and a day already past are untouched", (await stored(d.d2)).mark === "fine-2" && (await stored(d.past)).mark === "old-past");
      const rec = await h.one("select try_number, source, note, summary, cardinality(dates) as nd, previous_plan -> 0 #>> '{meals,daily,0,mark}' as first_mark from public.meal_plan_tries where athlete_id = $1", [ann]);
      h.check("a copy of the days from before is kept, as an allergy rebuild (try 0), with the coach's notice as its summary", rec.try_number === 0 && rec.source === "allergy" && rec.note === "" && rec.summary === NOTICE && rec.nd === 2 && rec.first_mark === "peanut-0", JSON.stringify(rec));
      h.check("it does not count as one of the client's tries: the plan still reads try 2", (await h.one("select max(public.meal_plan_try_number(rationale))::int as n from public.meal_plans where athlete_id = $1 and log_date >= current_date", [ann])).n === 2);
      const notes = await h.rows("select profile_id, body, link_path from public.notifications where type = 'meal_plan_try' and group_id = $1", [group]);
      h.check("the coach is told once, with the server's line and a link to the client", notes.length === 1 && notes[0].profile_id === coach && notes[0].body === NOTICE && notes[0].link_path === `/groups/${group}/nutrition?athleteId=${ann}`, JSON.stringify(notes));

      // the client can still ask for a different plan afterwards: try 3 (the try function is unchanged)
      const t3 = (await h.one("select public.apply_meal_plan_try($1, $2, current_date, $3::jsonb, 'x', 'y') as n", [ann, group, JSON.stringify([{ log_date: d.d0, archetype: "omnivore", meal_count: 3, macros: { daily: {} }, meals: { daily: [{ mealId: "m1", mark: "t3" }] }, created_by: coach }])])).n;
      h.check("a client try after an allergy rebuild is numbered on from the plan (3), not reset", t3 === 3, String(t3));

      // refusals change nothing
      const before = await h.one("select count(*)::int as c from public.meal_plan_tries where athlete_id = $1", [ann]);
      await h.expectError("a day that has already passed is refused", () => apply(ann, group, [d.past], "bad"), /bad_dates/);
      await h.expectError("a day the client has no plan for is refused (it never creates a day)", () => apply(ann, group, [d.d5], "bad"), /bad_dates/);
      await h.expectError("a day in another group is refused", () => apply(ann, other, [d.d2], "bad"), /not_a_client/);
      await h.expectError("the same day twice is refused", () => apply(ann, group, [d.d2, d.d2], "bad"), /bad_rows/);
      await h.expectError("meals that are not an object are refused", () => h.one("select public.apply_allergy_rebuild($1, $2, current_date, $3::jsonb, 'x') as n", [ann, group, JSON.stringify([{ log_date: d.d2, meals: [] }])]), /bad_rows/);
      await h.expectError("an empty notice is refused", () => apply(ann, group, [d.d2], "bad", "  "), /bad_request/);
      await h.expectError("someone who is not a client of the group is refused", () => apply(bo, group, [d.d2], "bad"), /not_a_client/);
      h.check("none of the refusals left a record or changed a day", (await h.one("select count(*)::int as c from public.meal_plan_tries where athlete_id = $1", [ann])).c === before.c && (await stored(d.d2)).mark === "fine-2");

      await h.as(ann);
      await h.expectError("a client cannot run it themselves", () => h.one("select public.apply_allergy_rebuild($1, $2, current_date, $3::jsonb, 'x') as n", [ann, group, rows([d.d2], "bad")]), /permission denied/);

      // the coach cannot put an allergy rebuild back; a client try newer than it can be
      await h.asSuper();
      const allergyRow = (await h.one("select id from public.meal_plan_tries where athlete_id = $1 and source = 'allergy'", [ann])).id;
      const tryRow = (await h.one("select id from public.meal_plan_tries where athlete_id = $1 and source = 'client' order by requested_at desc limit 1", [ann])).id;
      await h.as(coach);
      await h.expectError("an allergy rebuild cannot be put back", () => h.one("select public.restore_meal_plan_try($1) as n", [allergyRow]), /allergy_rebuild/);
      const put = (await h.one("select public.restore_meal_plan_try($1) as n", [tryRow])).n;
      await h.asSuper();
      h.check("the client's later try can still be put back, to the plan the allergy rebuild left", put === 1 && (await stored(d.d0)).mark === "safe", JSON.stringify(await stored(d.d0)));

      await h.expectError("a try row cannot be written with try 0 unless it is an allergy rebuild", () => db.query("insert into public.meal_plan_tries (athlete_id, group_id, try_number, dates) values ($1, $2, 0, array[current_date])", [ann, group]), /meal_plan_tries_number_ok/);
      await h.expectError("an allergy rebuild row is always try 0", () => db.query("insert into public.meal_plan_tries (athlete_id, group_id, try_number, source, dates) values ($1, $2, 1, 'allergy', array[current_date])", [ann, group]), /meal_plan_tries_number_ok/);
    },
  },
};
