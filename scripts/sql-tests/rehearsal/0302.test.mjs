// 0302: custom foods and saved meals. A client's own foods and meals: only they write them, their coaches read them, nobody else sees them; absurd numbers are refused; limits stop
// a pile-up; deleting a meal removes its foods.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0302 custom foods and saved meals",
  migrations: ["0302"],
  phases: {
    async "0301"({ db, h }) {
      const t = await h.one(`select to_regclass('public.custom_foods') as a, to_regclass('public.saved_meals') as b`);
      h.check("baseline: no custom food tables yet", t.a === null && t.b === null, JSON.stringify(t));
      const coach = await h.user("CF Coach");
      const otherCoach = await h.user("CF Other Coach");
      const ann = await h.user("CF Ann");
      const bob = await h.user("CF Bob");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "CF group");
      await h.member(group, ann);
      await h.member(group, bob);
      const org2 = await h.org(otherCoach);
      await h.group(org2, otherCoach, "team", "CF other group");
      globalThis.__cf = { coach, otherCoach, ann, bob, group };
    },

    async "0302"({ db, h }) {
      const { coach, otherCoach, ann, bob } = globalThis.__cf;

      // ---- a client creates their own food ----
      await h.as(ann);
      const bar = await tryQ(db, `insert into public.custom_foods (athlete_id, name, brand, serving_label, serving_g, calories, protein_g, carbs_g, fat_g, nutrients, barcode) values ($1, 'Peanut crunch bar', 'Acme', '1 bar', 60, 230, 20, 22, 8, '{"fiber_g": 5, "sodium_mg": 190}'::jsonb, '0123456789012') returning id`, [ann]);
      h.check("a client creates a custom food with a label and a barcode", !bar.error && bar.rows?.length === 1, JSON.stringify(bar));
      const dupe = await tryQ(db, `insert into public.custom_foods (athlete_id, name, serving_label, calories, barcode) values ($1, 'Same code', '1', 100, '0123456789012')`, [ann]);
      h.check("the same barcode cannot be added twice for one client", !!dupe.error, JSON.stringify(dupe));
      const forge = await tryQ(db, `insert into public.custom_foods (athlete_id, name, serving_label, calories) values ($1, 'forged', '1', 100)`, [bob]);
      h.check("a client cannot create a food for someone else", !!forge.error, JSON.stringify(forge));

      // ---- absurd numbers ----
      const cases = [
        ["500,000 calories", `calories = 500000`],
        ["negative protein", `calories = 100, protein_g = -3`],
        ["an empty name", `calories = 100, name = '   '`],
        ["a 10 kg serving", `calories = 100, serving_g = 10000`],
      ];
      for (const [label, set] of cases) {
        const r = await tryQ(db, `insert into public.custom_foods (athlete_id, name, serving_label, calories) values ($1, 'x', '1', 1)  returning id`, [ann]);
        const id = r.rows?.[0]?.id;
        const bad = await tryQ(db, `update public.custom_foods set ${set} where id = $1`, [id]);
        h.check(`${label} is refused`, !!bad.error, JSON.stringify(bad));
        await tryQ(db, `delete from public.custom_foods where id = $1`, [id]);
      }
      const notObj = await tryQ(db, `insert into public.custom_foods (athlete_id, name, serving_label, calories, nutrients) values ($1, 'x', '1', 1, '[1]'::jsonb)`, [ann]);
      h.check("a label must be an object", !!notObj.error, JSON.stringify(notObj));
      for (const [label, json] of [["a text value", `{"fiber_g": "lots"}`], ["a negative value", `{"fiber_g": -2}`], ["an absurd value", `{"fiber_g": 99999999}`], ["a nested object", `{"fiber_g": {"a": 1}}`], ["a null value", `{"fiber_g": null}`]]) {
        const r = await tryQ(db, `insert into public.custom_foods (athlete_id, name, serving_label, calories, nutrients) values ($1, 'x', '1', 1, $2::jsonb)`, [ann, json]);
        h.check(`a label with ${label} is refused (every value must be a number from 0 to 1,000,000)`, !!r.error, JSON.stringify(r));
      }
      const goodLabel = await tryQ(db, `insert into public.custom_foods (athlete_id, name, serving_label, calories, nutrients) values ($1, 'ok label', '1', 1, '{"fiber_g": 0, "sodium_mg": 190.5}'::jsonb) returning id`, [ann]);
      h.check("a label of plain numbers is accepted", !goodLabel.error && goodLabel.rows?.length === 1, JSON.stringify(goodLabel));
      await tryQ(db, `delete from public.custom_foods where id = $1`, [goodLabel.rows?.[0]?.id]);
      // updated_at is stamped by the database on any change
      await h.asSuper();
      await db.query(`update public.custom_foods set updated_at = '2020-01-01' where athlete_id = $1 and name = 'Peanut crunch bar'`, [ann]);
      await h.as(ann);
      const touched = await tryQ(db, `update public.custom_foods set calories = 231 where athlete_id = $1 and name = 'Peanut crunch bar' returning updated_at > '2025-01-01' as fresh`, [ann]);
      h.check("changing a custom food stamps updated_at in the database", touched.rows?.[0]?.fresh === true, JSON.stringify(touched));

      // ---- who can see them ----
      await h.as(bob);
      const bobSees = await tryQ(db, `select count(*)::int as n from public.custom_foods`);
      h.check("another client cannot see Ann's foods", bobSees.rows?.[0]?.n === 0, JSON.stringify(bobSees));
      const bobEdit = await tryQ(db, `update public.custom_foods set calories = 1 returning id`);
      h.check("or change them", !bobEdit.error && (bobEdit.rows?.length ?? 0) === 0, JSON.stringify(bobEdit));
      await h.as(coach);
      const coachSees = await tryQ(db, `select count(*)::int as n from public.custom_foods where athlete_id = $1`, [ann]);
      h.check("the client's coach can read their custom foods", coachSees.rows?.[0]?.n === 1, JSON.stringify(coachSees));
      const coachWrite = await tryQ(db, `update public.custom_foods set calories = 1 where athlete_id = $1 returning id`, [ann]);
      h.check("but cannot change them", !coachWrite.error && (coachWrite.rows?.length ?? 0) === 0, JSON.stringify(coachWrite));
      await h.as(otherCoach);
      const otherSees = await tryQ(db, `select count(*)::int as n from public.custom_foods`);
      h.check("a coach of another group cannot read them", otherSees.rows?.[0]?.n === 0, JSON.stringify(otherSees));

      // ---- saved meals ----
      await h.as(ann);
      const meal = await tryQ(db, `insert into public.saved_meals (athlete_id, name) values ($1, 'Usual breakfast') returning id`, [ann]);
      const mealId = meal.rows?.[0]?.id;
      h.check("a client saves a meal", !meal.error && !!mealId, JSON.stringify(meal));
      const item = await tryQ(db, `insert into public.saved_meal_items (meal_id, position, name, serving_label, serving_qty, amount_g, calories, protein_g, carbs_g, fat_g) values ($1, 0, 'Oats', '1 cup', 1, 81, 307, 11, 55, 5) returning id`, [mealId]);
      h.check("with foods in it", !item.error && item.rows?.length === 1, JSON.stringify(item));
      await h.as(bob);
      const bobItem = await tryQ(db, `insert into public.saved_meal_items (meal_id, position, name, calories) values ($1, 1, 'sneaky', 10)`, [mealId]);
      h.check("another client cannot add a food to Ann's meal", !!bobItem.error, JSON.stringify(bobItem));
      const bobMeals = await tryQ(db, `select count(*)::int as n from public.saved_meals`);
      const bobItems = await tryQ(db, `select count(*)::int as n from public.saved_meal_items`);
      h.check("or read her meals or their foods", bobMeals.rows?.[0]?.n === 0 && bobItems.rows?.[0]?.n === 0, JSON.stringify({ bobMeals, bobItems }));
      await h.as(coach);
      const coachMeals = await tryQ(db, `select (select count(*)::int from public.saved_meals) as meals, (select count(*)::int from public.saved_meal_items) as items`);
      h.check("the client's coach reads the saved meal and its foods", coachMeals.rows?.[0]?.meals === 1 && coachMeals.rows?.[0]?.items === 1, JSON.stringify(coachMeals));
      await h.as(otherCoach);
      const otherMeals = await tryQ(db, `select count(*)::int as n from public.saved_meal_items`);
      h.check("a coach of another group cannot", otherMeals.rows?.[0]?.n === 0, JSON.stringify(otherMeals));

      // ---- limits ----
      await h.asSuper();
      await db.query(`insert into public.saved_meal_items (meal_id, position, name, calories) select $1, g, 'f' || g, 1 from generate_series(1, 59) g`, [mealId]);
      const sixtyFirst = await tryQ(db, `insert into public.saved_meal_items (meal_id, position, name, calories) values ($1, 61, 'too many', 1)`, [mealId]);
      h.check("a meal holds at most 60 foods", !!sixtyFirst.error && /60 foods/.test(sixtyFirst.error), JSON.stringify(sixtyFirst));
      await db.query(`insert into public.custom_foods (athlete_id, name, serving_label, calories) select $1, 'bulk ' || g, '1', 1 from generate_series(1, 999) g`, [bob]);
      const thousand = await tryQ(db, `insert into public.custom_foods (athlete_id, name, serving_label, calories) values ($1, 'one more', '1', 1), ($1, 'and one more', '1', 1)`, [bob]);
      h.check("a client holds at most 1,000 custom foods", !!thousand.error && /1,000/.test(thousand.error), JSON.stringify(thousand));

      // ---- deleting a meal removes its foods ----
      await h.as(ann);
      const del = await tryQ(db, `delete from public.saved_meals where id = $1 returning id`, [mealId]);
      const left = await tryQ(db, `select count(*)::int as n from public.saved_meal_items where meal_id = $1`, [mealId]);
      h.check("deleting a saved meal removes its foods", !del.error && del.rows?.length === 1 && left.rows?.[0]?.n === 0, JSON.stringify({ del, left }));
    },
  },
};
