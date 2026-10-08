// 0311: a client can ask for a different meal plan, up to 3 times per plan. Proves: the new notification type is added without dropping the old ones; the tries table is readable by the client
// and their coach only, and by nobody for writing; applying a try counts, snapshots and rebuilds (never a day built by hand, never a past day), tells the coach in fixed wording (never the
// client's words), refuses a 4th; only the server can apply one; the coach's put-back goes one step back, only for the right coach, and leaves a day changed by hand alone; and a plan the
// coach assigns anew starts the count over.
export default {
  name: "0311 a client can ask for a different meal plan",
  migrations: ["0311"],
  phases: {
    async "0311"({ db, h }) {
      const coach = await h.user("MT Coach");
      const other = await h.user("MT Other Coach");
      const ann = await h.user("MT Ann");
      const bo = await h.user("MT Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "MT group");
      await h.member(group, ann);
      await h.member(group, bo);
      const otherOrg = await h.org(other);
      await h.group(otherOrg, other, "team", "MT other group");

      await h.asSuper();
      const def = await h.one("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_type_check'");
      h.check("the new notification type is in the list, and the older types are still there", /meal_plan_try/.test(def.def) && /new_training_block|nutrition_prompt_answered/.test(def.def) && /'comment'/.test(def.def), def.def.slice(0, 200));
      const acl = await h.one(
        "select has_function_privilege('service_role', 'public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text)', 'execute') as s, has_function_privilege('authenticated', 'public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text)', 'execute') as a, has_function_privilege('anon', 'public.apply_meal_plan_try(uuid, uuid, date, jsonb, text, text)', 'execute') as n, has_function_privilege('anon', 'public.restore_meal_plan_try(uuid)', 'execute') as rn, has_function_privilege('authenticated', 'public.restore_meal_plan_try(uuid)', 'execute') as ra"
      );
      h.check("only the server can apply a try; a coach (signed in) can run the put-back; signed-out visitors can run neither", acl.s === true && acl.a === false && acl.n === false && acl.ra === true && acl.rn === false, JSON.stringify(acl));

      const LIB = "Built from the recipe library for the week.";
      const dayKey = async (offset) => (await h.one("select (current_date + $1::int)::text as d", [offset])).d;
      const d = { past: await dayKey(-2), d0: await dayKey(0), d1: await dayKey(1), d2: await dayKey(2), d3: await dayKey(3), d4: await dayKey(4) };
      const plan = (date, rationale, mark) => [ann, group, date, "omnivore", 3, false, false, rationale, { daily: { calories: 2000, protein: 150, carbs: 200, fats: 60 } }, { daily: [{ mealId: "m1", mark }] }, coach];
      const seed = async (date, rationale, mark) =>
        db.query(
          "insert into public.meal_plans (athlete_id, group_id, log_date, archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11) on conflict (athlete_id, log_date) do update set rationale = excluded.rationale, macros = excluded.macros, meals = excluded.meals",
          plan(date, rationale, mark).map((v) => (v && typeof v === "object" ? JSON.stringify(v) : v))
        );
      await seed(d.past, LIB, "old-past");
      await seed(d.d0, LIB, "orig-0");
      await seed(d.d1, LIB, "orig-1");
      await seed(d.d2, LIB, "orig-2");
      await seed(d.d3, "Made by hand for this client.", "hand-3");
      const rowsFor = (dates, mark) =>
        JSON.stringify(dates.map((date) => ({ log_date: date, archetype: "omnivore", meal_count: 3, include_snack: false, carb_cycling: false, macros: { daily: { calories: 2000 } }, meals: { daily: [{ mealId: "m1", mark }] }, created_by: coach })));
      const apply = async (dates, mark, note = "no fish please", summary = "avoids fish") =>
        (await h.one("select public.apply_meal_plan_try($1, $2, current_date, $3::jsonb, $4, $5) as n", [ann, group, rowsFor(dates, mark), note, summary])).n;
      const stored = async (date) => h.one("select rationale, meals #>> '{daily,0,mark}' as mark, created_by from public.meal_plans where athlete_id = $1 and log_date = $2", [ann, date]);

      // ---- try 1
      await h.asSuper();
      const n1 = await apply([d.d0, d.d1, d.d2], "t1", "SECRET WORDS the client typed");
      h.check("the first try is number 1", n1 === 1, String(n1));
      const afterOne = [await stored(d.d0), await stored(d.d1), await stored(d.d2)];
      h.check("the three library days are replaced and say which try rebuilt them", afterOne.every((r) => r.mark === "t1" && r.rationale === "Rebuilt at the client's request (try 1 of 3)."), JSON.stringify(afterOne));
      h.check("the day the coach built by hand and the day that already passed are untouched", (await stored(d.d3)).mark === "hand-3" && (await stored(d.past)).mark === "old-past");
      const tryRow = await h.one("select try_number, note, summary, cardinality(dates) as nd, jsonb_array_length(previous_plan) as np, previous_plan -> 0 #>> '{meals,daily,0,mark}' as first_mark from public.meal_plan_tries where athlete_id = $1 order by requested_at desc limit 1", [ann]);
      h.check("the try keeps what was typed, a summary, the days, and a copy of the plan from before", tryRow.try_number === 1 && tryRow.note === "SECRET WORDS the client typed" && tryRow.summary === "avoids fish" && tryRow.nd === 3 && tryRow.np === 3 && tryRow.first_mark === "orig-0", JSON.stringify(tryRow));
      const notice = await h.rows("select profile_id, body, link_path from public.notifications where type = 'meal_plan_try' and group_id = $1", [group]);
      h.check("the coach is told once, in fixed words, with a link to the client; the client's own words are not in it", notice.length === 1 && notice[0].profile_id === coach && /try 1 of 3/.test(notice[0].body) && !/SECRET|fish/i.test(notice[0].body) && notice[0].link_path === `/groups/${group}/nutrition?athleteId=${ann}`, JSON.stringify(notice));

      // ---- refusals leave everything as it was
      await h.expectError("a day the coach built by hand is refused", () => apply([d.d1, d.d3], "bad"), /hand_built/);
      await h.expectError("a day that has already passed is refused", () => apply([d.past], "bad"), /bad_dates/);
      await h.expectError("a day more than 60 days out is refused", async () => apply([await dayKey(61)], "bad"), /bad_dates/);
      await h.expectError("the same day twice is refused", () => apply([d.d1, d.d1], "bad"), /bad_rows/);
      await h.expectError("a plan author who is not a coach of the group is refused", () => h.one("select public.apply_meal_plan_try($1, $2, current_date, $3::jsonb, '', '') as n", [ann, group, JSON.stringify([{ log_date: d.d1, archetype: "omnivore", meal_count: 3, macros: {}, meals: {}, created_by: other }])]), /bad_rows/);
      await h.expectError("someone who is not a client of the group is refused", () => h.one("select public.apply_meal_plan_try($1, $2, current_date, $3::jsonb, '', '') as n", [other, group, rowsFor([d.d1], "bad")]), /not_a_client/);
      const stillOne = await h.one("select count(*)::int as c from public.meal_plan_tries where athlete_id = $1", [ann]);
      h.check("none of the refusals left a try or changed a day", stillOne.c === 1 && (await stored(d.d1)).mark === "t1");

      // ---- tries 2 and 3, then no 4th
      const n2 = await apply([d.d0, d.d1, d.d2], "t2");
      const n3 = await apply([d.d1, d.d2], "t3");
      h.check("the second and third tries are numbered 2 and 3", n2 === 2 && n3 === 3, `${n2} ${n3}`);
      await h.expectError("a fourth try is refused", () => apply([d.d1], "t4"), /no_tries_left/);
      h.check("the refused fourth try changed nothing", (await stored(d.d1)).mark === "t3" && (await h.one("select count(*)::int as c from public.meal_plan_tries where athlete_id = $1", [ann])).c === 3);

      // ---- who can read the tries
      await h.as(ann);
      h.check("the client reads their own tries", (await h.rows("select id from public.meal_plan_tries")).length === 3);
      await h.as(coach);
      h.check("the client's coach reads them", (await h.rows("select id from public.meal_plan_tries")).length === 3);
      await h.as(bo);
      h.check("another client in the same group does not", (await h.rows("select id from public.meal_plan_tries")).length === 0);
      await h.as(other);
      h.check("a coach of another group does not", (await h.rows("select id from public.meal_plan_tries")).length === 0);
      await h.as(ann);
      const w1 = await db.query("update public.meal_plan_tries set note = 'x'").catch(() => ({ rowCount: 0 }));
      const w2 = await db.query("delete from public.meal_plan_tries").catch(() => ({ rowCount: 0 }));
      let inserted = true;
      try {
        await db.query("insert into public.meal_plan_tries (athlete_id, group_id, try_number, dates) values ($1, $2, 1, array[current_date])", [ann, group]);
      } catch {
        inserted = false;
      }
      h.check("nobody can write to the tries directly (not even the client)", (w1.rowCount ?? 0) === 0 && (w2.rowCount ?? 0) === 0 && inserted === false);
      await h.asSuper();
      const grants = await h.one("select has_table_privilege('anon', 'public.meal_plan_tries', 'select') as asel, has_table_privilege('authenticated', 'public.meal_plan_tries', 'insert') as ains, has_table_privilege('authenticated', 'public.meal_plan_tries', 'update') as aupd, has_table_privilege('authenticated', 'public.meal_plan_tries', 'delete') as adel, has_table_privilege('authenticated', 'public.meal_plan_tries', 'select') as sel");
      h.check("the tries table is closed at the grant level too: signed-out visitors have nothing, signed-in users can only read", grants.asel === false && grants.ains === false && grants.aupd === false && grants.adel === false && grants.sel === true, JSON.stringify(grants));
      await h.expectError("the signed-in client cannot call the apply function", async () => {
        await h.as(ann);
        await db.query("select public.apply_meal_plan_try($1, $2, current_date, $3::jsonb, '', '')", [ann, group, rowsFor([d.d1], "x")]);
      }, /permission denied/);

      // ---- the coach's put-back
      await h.asSuper();
      const lastTry = async () => (await h.one("select id from public.meal_plan_tries where athlete_id = $1 and restored_at is null order by requested_at desc, id desc limit 1", [ann])).id;
      const firstTry = (await h.one("select id from public.meal_plan_tries where athlete_id = $1 and try_number = 1", [ann])).id;
      const latest = await lastTry();
      await h.as(ann);
      await h.expectError("the client cannot put a plan back", () => h.one("select public.restore_meal_plan_try($1) as n", [latest]), /not_allowed/);
      await h.as(other);
      await h.expectError("a coach of another group cannot", () => h.one("select public.restore_meal_plan_try($1) as n", [latest]), /not_allowed/);
      await h.as(coach);
      await h.expectError("an earlier try cannot be put back before the later ones", () => h.one("select public.restore_meal_plan_try($1) as n", [firstTry]), /not_latest/);
      await h.expectError("a try that does not exist is refused", () => h.one("select public.restore_meal_plan_try('00000000-0000-0000-0000-000000000000') as n"), /not_found/);
      // the coach changes day 2 by hand after try 3: that day must be left alone by the put-back
      await db.query("update public.meal_plans set rationale = 'Built from the recipe library, then edited by hand.', meals = '{\"daily\":[{\"mealId\":\"m1\",\"mark\":\"coach-edit\"}]}'::jsonb where athlete_id = $1 and log_date = $2", [ann, d.d2]);
      const back = (await h.one("select public.restore_meal_plan_try($1) as n", [latest])).n;
      h.check("putting back try 3 restores the day it changed and leaves the day the coach edited by hand", back === 1 && (await stored(d.d1)).mark === "t2" && (await stored(d.d2)).mark === "coach-edit", `${back} ${(await stored(d.d1)).mark} ${(await stored(d.d2)).mark}`);
      await h.expectError("the same try cannot be put back twice", () => h.one("select public.restore_meal_plan_try($1) as n", [latest]), /already_restored/);
      await h.asSuper();
      // after the put-back the client has a try left again (their count is what the standing plan says: try 2)
      const n3b = await apply([d.d0, d.d1], "t3b");
      h.check("after a put-back, the next try is numbered from the plan that is standing", n3b === 3, String(n3b));

      // a day with NO plan before the try is removed by the put-back
      await h.asSuper();
      const restoreAll = async () => {
        await h.as(coach);
        let id = await lastTry();
        for (let i = 0; i < 5 && id; i++) {
          await h.one("select public.restore_meal_plan_try($1) as n", [id]);
          id = await db.query("select id from public.meal_plan_tries where athlete_id = $1 and restored_at is null order by requested_at desc, id desc limit 1", [ann]).then((r) => r.rows[0]?.id);
        }
        await h.asSuper();
      };
      await restoreAll();
      h.check("putting every try back returns the plan to what the coach assigned", (await stored(d.d0)).mark === "orig-0" && (await stored(d.d1)).mark === "orig-1" && (await stored(d.d0)).rationale === LIB);
      await db.query("delete from public.meal_plans where athlete_id = $1 and log_date = $2", [ann, d.d4]);
      const nNew = await apply([d.d4], "t-new-day");
      h.check("a try can also fill a day that had no plan, and putting it back removes that day", nNew === 1 && (await stored(d.d4)).mark === "t-new-day");
      await h.as(coach);
      await h.one("select public.restore_meal_plan_try($1) as n", [await lastTry()]);
      await h.asSuper();
      h.check("the day that had no plan has none again", (await db.query("select 1 from public.meal_plans where athlete_id = $1 and log_date = $2", [ann, d.d4])).rowCount === 0);

      // ---- the coach assigns a new plan: the count starts over
      await apply([d.d0], "u1");
      await apply([d.d0], "u2");
      await seed(d.d0, LIB, "coach-new");
      await seed(d.d1, LIB, "coach-new");
      await seed(d.d2, LIB, "coach-new");
      const afterNew = await apply([d.d0], "after-new");
      h.check("a plan the coach assigns anew starts the count over", afterNew === 1, String(afterNew));

      // ---- the number is read from the rationale only when it is exactly the standing words
      const num = await h.one("select public.meal_plan_try_number('Rebuilt at the client''s request (try 2 of 3).') as a, public.meal_plan_try_number('Rebuilt at the client''s request (try 9 of 3).') as b, public.meal_plan_try_number('Built from the recipe library for the week.') as c, public.meal_plan_try_number(null) as d");
      h.check("the try number is read only from the exact wording", num.a === 2 && num.b === null && num.c === null && num.d === null, JSON.stringify(num));
    },
  },
};
