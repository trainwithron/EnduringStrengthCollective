// 0429 Set my targets: a client whose coach has set no nutrition target may set their own (set_by 'self'); a coach's row always wins and is always a coach row.
const T = "public.client_macro_target_history";
export default {
  name: "0429 a client sets their own targets until their coach sets one",
  migrations: ["0429"],
  phases: {
    async "0429"({ db, h }) {
      const coach = await h.user("ST Coach");
      const ann = await h.user("ST Ann");
      const bob = await h.user("ST Bob");
      const kid = await h.user("ST Kid");
      const cara = await h.user("ST Cara");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "ST team");
      const other = await h.group(org, coach, "team", "ST other team");
      for (const p of [ann, bob, kid, cara]) await h.member(g, p);
      await h.asSuper();
      // ann, bob and cara are adults on file; kid is 15 with no signed guardian
      for (const p of [ann, bob, cara]) await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, current_date - interval '30 years')`, [p, g]);
      await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, current_date - interval '15 years')`, [kid, g]);

      const write = (who, grp, day, setBy, cal = 2200) =>
        db.query(`insert into ${T} (athlete_id, group_id, effective_from, calories, protein_g, set_by, created_by) values ($1, $2, current_date + $3::int, $4, 150, $5, $1)`, [who, grp, day, cal, setBy]);

      h.check("every row so far is a coach row (the new column's default)", (await h.one(`select count(*)::int as n from ${T} where set_by <> 'coach'`)).n === 0);

      await h.as(ann);
      await write(ann, g, 0, "self");
      h.check("a client with no target from their coach saves their own", (await h.one(`select set_by, calories from ${T} where athlete_id = $1`, [ann])).set_by === "self");
      await db.query(`update ${T} set calories = 2300 where athlete_id = $1 and effective_from = current_date`, [ann]);
      h.check("...changes it", (await h.one(`select calories from ${T} where athlete_id = $1`, [ann])).calories === 2300);
      await write(ann, g, 1, "self", 2400);
      await db.query(`delete from ${T} where athlete_id = $1 and effective_from = current_date + 1`, [ann]);
      h.check("...and removes one", (await h.one(`select count(*)::int as n from ${T} where athlete_id = $1`, [ann])).n === 1);
      await h.expectError("a client cannot write a coach row for themselves", () => write(ann, g, 0, "coach", 2500), /row-level security/i);
      await h.expectError("a client cannot write a row for someone else", () => write(bob, g, 0, "self"), /row-level security/i);
      await h.expectError("a client cannot write in a group they are not in", () => write(ann, other, 0, "self"), /row-level security/i);
      await h.expectError("a client cannot backdate a target", () => write(ann, g, -5, "self"), /row-level security/i);
      await h.expectError("...or date one far ahead", () => write(ann, g, 5, "self"), /row-level security/i);

      await h.as(kid);
      await h.expectError("a 15-year-old without a signed guardian cannot set a target", () => write(kid, g, 0, "self"), /row-level security/i);

      // Ann's own change raised no notice; a coach change does.
      await h.asSuper();
      h.check("a client changing their own target is not told it changed", (await h.one(`select count(*)::int as n from public.notifications where profile_id = $1 and type = 'nutrition_target_changed'`, [ann])).n === 0);
      await db.query(`insert into ${T} (athlete_id, group_id, effective_from, calories, set_by) values ($1, $2, current_date - 3, 2000, 'self')`, [bob, g]);

      // The coach sets Bob's target over the same day as a self row Bob had, and sends 'self': it becomes a coach row.
      await h.as(bob);
      await write(bob, g, 0, "self", 2100);
      await h.as(coach);
      await db.query(
        `insert into ${T} (athlete_id, group_id, effective_from, calories, protein_g, set_by, created_by) values ($1, $2, current_date, 2600, 180, 'self', $3)
         on conflict (athlete_id, group_id, effective_from) do update set calories = excluded.calories, protein_g = excluded.protein_g, set_by = excluded.set_by, created_by = excluded.created_by`,
        [bob, g, coach]
      );
      await h.asSuper();
      const bobRow = await h.one(`select set_by, calories from ${T} where athlete_id = $1 and effective_from = current_date`, [bob]);
      h.check("a coach writing over a client's same-day row makes it a coach row (whatever was sent)", bobRow.set_by === "coach" && bobRow.calories === 2600, JSON.stringify(bobRow));

      await h.as(bob);
      await h.expectError("once the coach has set a target the client cannot add their own", () => write(bob, g, 1, "self", 1800), /row-level security/i);
      const del = await db.query(`delete from ${T} where athlete_id = $1 returning 1`, [bob]);
      h.check("...nor remove any row (their old own rows stay as history)", del.rowCount === 0);
      const upd = await db.query(`update ${T} set calories = 1500 where athlete_id = $1 returning 1`, [bob]);
      h.check("...nor change any row", upd.rowCount === 0);
      h.check("has_coach_macro_target answers only about the caller", (await h.one(`select public.has_coach_macro_target($1, $2) as mine, public.has_coach_macro_target($3, $2) as other`, [bob, g, ann])).mine === true);
      await h.as(ann);
      h.check("...asking about someone else is always false", (await h.one(`select public.has_coach_macro_target($1, $2) as v`, [bob, g])).v === false);

      // A target in the old single-row table counts as the coach's.
      await h.asSuper();
      await db.query(`insert into public.client_macro_targets (athlete_id, group_id, calories) values ($1, $2, 2500)`, [cara, g]);
      await h.as(cara);
      await h.expectError("a target from the coach in the old single-row table also blocks the client's own", () => write(cara, g, 0, "self"), /row-level security/i);

      // The coach's own policy is unchanged: a coach can still write any client's target.
      await h.as(coach);
      await write(ann, g, 1, "coach", 2700);
      await h.asSuper();
      h.check("the coach can still set a client's target, and it is a coach row", (await h.one(`select set_by from ${T} where athlete_id = $1 and effective_from = current_date + 1`, [ann])).set_by === "coach");
      h.check("a coach change still tells the client", (await h.one(`select count(*)::int as n from public.notifications where profile_id = $1 and type = 'nutrition_target_changed'`, [ann])).n === 1);

      // The undo file removes the client's rights and the helper, and the step can be applied again.
      const { readFileSync } = await import("node:fs");
      const here = new URL("../../../", import.meta.url);
      await db.exec(readFileSync(new URL("supabase/apply/undo-step181-0429.sql", here), "utf8"));
      h.check("the undo drops the three client policies and the helper", (await h.one(`select count(*)::int as n from pg_policies where tablename = 'client_macro_target_history' and policyname like '%self%'`)).n === 0 && (await h.one(`select to_regprocedure('public.has_coach_macro_target(uuid, uuid)') is null as gone`)).gone);
      await db.exec(readFileSync(new URL("supabase/migrations/0429_client_sets_own_targets.sql", here), "utf8"));
      h.check("the step applies again after the undo", (await h.one(`select count(*)::int as n from pg_policies where tablename = 'client_macro_target_history' and policyname like '%self%'`)).n === 3);
    },
  },
};
