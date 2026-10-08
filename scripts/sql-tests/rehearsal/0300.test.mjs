// 0300: food search and logging. USDA household portions are public reference data nobody can write from the app; the food log gets the optional detail of a searched food;
// absurd amounts cannot be logged from now on; and who can read or write a food log is exactly what it was.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0300 food search and logging",
  migrations: ["0300"],
  phases: {
    async "0298"({ db, h }) {
      const t = await h.one(`select to_regclass('public.usda_food_portions') as p, to_regclass('public.usda_load_batches') as b`);
      h.check("baseline: no portions table yet", t.p === null && t.b === null, JSON.stringify(t));
      const coach = await h.user("FS Coach");
      const ann = await h.user("FS Ann");
      const bob = await h.user("FS Bob");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "FS group");
      await h.member(group, ann);
      await h.member(group, bob);
      await h.asSuper();
      await db.query(`insert into public.usda_foods (fdc_id, description, data_type) values (900001, 'Rice, white, long-grain, cooked', 'SR Legacy') on conflict do nothing`);
      // an entry logged the old way, before 0300
      await db.query(`insert into public.food_log_entries (athlete_id, group_id, log_date, status, description, calories, protein_g, carbs_g, fat_g) values ($1, $2, '2026-10-01', 'quick_log', 'before 0300', 300, 10, 40, 5)`, [ann, group]);
      globalThis.__fs = { coach, ann, bob, group };
    },

    async "0300"({ db, h }) {
      const { coach, ann, bob, group } = globalThis.__fs;

      // ---- the old entry is untouched, new columns are empty ----
      await h.asSuper();
      const old = await h.one(`select description, calories::int as calories, food_source, fdc_id, amount_g, nutrients from public.food_log_entries where athlete_id = $1`, [ann]);
      h.check("an entry logged before 0300 is unchanged and has no searched-food detail", old.description === "before 0300" && old.calories === 300 && old.food_source === null && old.fdc_id === null && old.amount_g === null && old.nutrients === null, JSON.stringify(old));

      // ---- portions are public reference data nobody can write from the app ----
      await h.asService();
      const seed = await tryQ(db, `insert into public.usda_food_portions (fdc_id, seq, description, gram_weight) values (900001, 1, '1 cup', 158), (900001, 2, '1 tbsp', 9.9) returning id`);
      h.check("the import (server key) can load portions", !seed.error && seed.rows?.length === 2, JSON.stringify(seed));
      await h.as(ann);
      const read = await tryQ(db, `select count(*)::int as n from public.usda_food_portions where fdc_id = 900001`);
      h.check("any signed-in person reads portions", read.rows?.[0]?.n === 2, JSON.stringify(read));
      const write = await tryQ(db, `insert into public.usda_food_portions (fdc_id, seq, description, gram_weight) values (900001, 9, 'forged', 1)`);
      h.check("but nobody can add one from the app", !!write.error, JSON.stringify(write));
      const upd = await tryQ(db, `update public.usda_food_portions set gram_weight = 1 where fdc_id = 900001`);
      h.check("or change one", !!upd.error || upd.rows?.length === 0, JSON.stringify(upd));
      const badWeight = await (async () => { await h.asService(); return tryQ(db, `insert into public.usda_food_portions (fdc_id, seq, description, gram_weight) values (900001, 3, 'zero', 0)`); })();
      h.check("a portion with no weight is refused", !!badWeight.error, JSON.stringify(badWeight));
      await h.as(ann);
      const batches = await tryQ(db, `insert into public.usda_load_batches (name, rows_loaded) values ('x', 1)`);
      h.check("nobody can mark an import batch loaded from the app", !!batches.error, JSON.stringify(batches));

      // ---- logging a searched food ----
      const nutrients = JSON.stringify({ kcal: 205, protein_g: 4.2, carbs_g: 44.5, fat_g: 0.4, fiber_g: 0.6 });
      const add = await tryQ(
        db,
        `insert into public.food_log_entries (athlete_id, group_id, log_date, meal_slot, status, description, calories, protein_g, carbs_g, fat_g, food_source, fdc_id, amount_g, serving_label, serving_qty, nutrients)
         values ($1, $2, '2026-10-08', 'lunch', 'quick_log', 'Rice, white, long-grain, cooked', 205, 4.2, 44.5, 0.4, 'usda', 900001, 158, '1 cup', 1, $3::jsonb) returning id`,
        [ann, group, nutrients]
      );
      h.check("a client logs a searched food with its serving and nutrient snapshot", !add.error && add.rows?.length === 1, JSON.stringify(add));
      const id = add.rows?.[0]?.id;
      const edit = await tryQ(db, `update public.food_log_entries set serving_qty = 1.5, amount_g = 237, calories = 308 where id = $1 returning calories::int as calories`, [id]);
      h.check("and edits the amount", !edit.error && edit.rows?.[0]?.calories === 308, JSON.stringify(edit));

      // ---- sane limits for new rows ----
      const tooBig = await tryQ(db, `insert into public.food_log_entries (athlete_id, group_id, log_date, status, description, calories) values ($1, $2, '2026-10-08', 'quick_log', 'absurd', 50000)`, [ann, group]);
      h.check("an absurd calorie amount is refused", !!tooBig.error, JSON.stringify(tooBig));
      const negative = await tryQ(db, `insert into public.food_log_entries (athlete_id, group_id, log_date, status, description, calories, protein_g) values ($1, $2, '2026-10-08', 'quick_log', 'negative', 100, -5)`, [ann, group]);
      h.check("a negative macro is refused", !!negative.error, JSON.stringify(negative));
      const zeroGrams = await tryQ(db, `insert into public.food_log_entries (athlete_id, group_id, log_date, status, description, calories, amount_g) values ($1, $2, '2026-10-08', 'quick_log', 'zero', 100, 0)`, [ann, group]);
      h.check("zero grams is refused", !!zeroGrams.error, JSON.stringify(zeroGrams));
      const badSource = await tryQ(db, `insert into public.food_log_entries (athlete_id, group_id, log_date, status, description, calories, food_source) values ($1, $2, '2026-10-08', 'quick_log', 'x', 100, 'made-up')`, [ann, group]);
      h.check("an unknown food source is refused", !!badSource.error, JSON.stringify(badSource));
      const notObject = await tryQ(db, `insert into public.food_log_entries (athlete_id, group_id, log_date, status, description, calories, nutrients) values ($1, $2, '2026-10-08', 'quick_log', 'x', 100, '[1,2]'::jsonb)`, [ann, group]);
      h.check("a nutrient snapshot must be an object", !!notObject.error, JSON.stringify(notObject));
      const oldStyle = await tryQ(db, `insert into public.food_log_entries (athlete_id, group_id, log_date, status, description, calories, protein_g, carbs_g, fat_g) values ($1, $2, '2026-10-08', 'quick_log', 'quick text log', 250, 12, 30, 8) returning id`, [ann, group]);
      h.check("a plain quick log still works exactly as before", !oldStyle.error && oldStyle.rows?.length === 1, JSON.stringify(oldStyle));

      // ---- who can see it is unchanged ----
      await h.as(bob);
      const bobSees = await tryQ(db, `select count(*)::int as n from public.food_log_entries`);
      h.check("another client still cannot read it", bobSees.rows?.[0]?.n === 0, JSON.stringify(bobSees));
      await h.as(coach);
      const coachSees = await tryQ(db, `select count(*)::int as n, count(*) filter (where fdc_id is not null)::int as searched from public.food_log_entries where athlete_id = $1`, [ann]);
      h.check("the group's coach reads the log, searched foods included", coachSees.rows?.[0]?.n === 3 && coachSees.rows?.[0]?.searched === 1, JSON.stringify(coachSees));
      const coachWrite = await tryQ(db, `update public.food_log_entries set calories = 1 where athlete_id = $1 returning id`, [ann]);
      h.check("and still cannot change it", !coachWrite.error && coachWrite.rows?.length === 0, JSON.stringify(coachWrite));

      // ---- ranked food search: the best match first even when a word matches far more than 300 foods ----
      await h.asSuper();
      // 600 foods that merely mention chicken or beef (inserted FIRST, so a plain unordered read would return them), then the foods a person means (inserted last).
      await db.query(`insert into public.usda_foods (fdc_id, description, data_type) select 910000 + g, 'Soup, chicken noodle, variety ' || g, 'SR Legacy' from generate_series(1, 400) g`);
      await db.query(`insert into public.usda_foods (fdc_id, description, data_type) select 920000 + g, 'Babyfood, dinner, beef and vegetables ' || g, 'SR Legacy' from generate_series(1, 400) g`);
      await db.query(`insert into public.usda_foods (fdc_id, description, data_type) values (930001, 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', 'SR Legacy'), (930002, 'Beef', 'Foundation'), (930003, 'Beef, ground, 93% lean meat / 7% fat, raw', 'Foundation'), (930004, 'Milk, whole, 3.25% milkfat', 'SR Legacy'), (930005, 'Oil, olive, salad or cooking', 'SR Legacy')`);
      await db.query(`insert into public.usda_food_nutrients (fdc_id, nutrient_key, amount_per_100g) values (930001, 'kcal', 165), (930001, 'protein_g', 31), (930001, 'carbs_g', 0), (930001, 'fat_g', 3.6)`);
      await h.as(ann);
      const chicken = await tryQ(db, `select fdc_id, description, kcal::int as kcal, protein_g::int as protein from public.search_usda_foods(array['chicken','breast'], 25)`);
      h.check("'chicken breast' finds the real chicken breast first, not one of 400 soups", chicken.rows?.[0]?.fdc_id === 930001 && chicken.rows[0].kcal === 165 && chicken.rows[0].protein === 31, JSON.stringify(chicken.rows?.slice(0, 2)));
      const beef = await tryQ(db, `select fdc_id from public.search_usda_foods(array['beef'], 25)`);
      h.check("'beef' (matched by 400+ foods) puts the food named Beef first, then ground beef, ahead of the baby food", beef.rows?.[0]?.fdc_id === 930002 && beef.rows?.[1]?.fdc_id === 930003, JSON.stringify(beef.rows?.slice(0, 3)));
      const milk = await tryQ(db, `select fdc_id from public.search_usda_foods(array['milk'], 25)`);
      h.check("'milk' finds milk", milk.rows?.[0]?.fdc_id === 930004, JSON.stringify(milk.rows?.slice(0, 2)));
      const oil = await tryQ(db, `select fdc_id from public.search_usda_foods(array['oil','olive'], 25)`);
      h.check("'oil olive' finds olive oil", oil.rows?.[0]?.fdc_id === 930005, JSON.stringify(oil.rows?.slice(0, 2)));
      const limited = await tryQ(db, `select count(*)::int as n from public.search_usda_foods(array['chicken'], 1000)`);
      h.check("never more than 100 rows, however many are asked for", limited.rows?.[0]?.n === 100, JSON.stringify(limited));
      const wild = await tryQ(db, `select count(*)::int as n from public.search_usda_foods(array['%', '_', ''], 25)`);
      h.check("wildcard characters are stripped, so they match nothing instead of everything", wild.rows?.[0]?.n === 0, JSON.stringify(wild));
      const none = await tryQ(db, `select count(*)::int as n from public.search_usda_foods(array[]::text[], 25)`);
      h.check("an empty search returns nothing", none.rows?.[0]?.n === 0, JSON.stringify(none));
      await h.asSuper();
      const anon = await h.one(`select has_function_privilege('anon', 'public.search_usda_foods(text[], integer)', 'execute') as a, has_function_privilege('authenticated', 'public.search_usda_foods(text[], integer)', 'execute') as s`);
      h.check("signed-in people can search; signed-out visitors cannot", anon.a === false && anon.s === true, JSON.stringify(anon));
    },
  },
};
