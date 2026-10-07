// 0296: the columns the library-first meal builder needs on the coach's recipes (source, tags, content hash, reference grams) and the rule that a line of an AI recipe must be
// matched to a real food. Who can read or write a recipe does not change.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

export default {
  name: "0296 recipe library columns",
  migrations: ["0296"],
  phases: {
    async "0295"({ db, h }) {
      const cols = await h.rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'recipes' and column_name in ('source', 'visibility', 'content_hash', 'main_protein')`);
      h.check("baseline: the recipes table has none of the new columns", cols.length === 0, JSON.stringify(cols));
      const coach = await h.user("R1 Coach Before");
      await h.asSuper();
      await db.query(`insert into public.recipes (created_by, name, slot) values ($1, 'Old recipe', 'lunch')`, [coach]);
      await db.query(`insert into public.recipe_ingredients (recipe_id, label, role, protein_per_100g) select id, 'Chicken', 'protein_source', 23 from public.recipes where name = 'Old recipe'`);
      globalThis.__r1 = { coach };
    },

    async "0296"({ db, h }) {
      const { coach } = globalThis.__r1;
      const coach2 = await h.user("R1 Coach Two");
      const client = await h.user("R1 Client");
      const other = await h.user("R1 Outsider");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "R1 group");
      await h.member(g, client);
      const org2 = await h.org(coach2);
      await h.group(org2, coach2, "team", "R1 other group");
      await h.asSuper();

      // ---- existing recipes are untouched ----
      const old = await h.one(`select source, visibility, allergens, content_hash from public.recipes where name = 'Old recipe'`);
      h.check("an existing recipe becomes a coach recipe, private, with no tags and no hash", old.source === "coach" && old.visibility === "private" && old.allergens.length === 0 && old.content_hash === null, JSON.stringify(old));
      const oldLine = await h.one(`select grams_ref from public.recipe_ingredients where label = 'Chicken'`);
      h.check("an existing ingredient line has no reference grams (the old scaler keeps working for it)", oldLine.grams_ref === null);

      // ---- the coach saves recipes ----
      await h.as(coach);
      const ok = await tryQ(db, `insert into public.recipes (created_by, name, slot, source, allergens, diet_tags, main_protein, reference_macros, content_hash) values ($1, 'Chicken bowl', 'lunch', 'coach', array['dairy'], array['omnivore'], 'chicken', '{"protein": 40, "carbs": 50, "fat": 10, "kcal": 410}'::jsonb, $2) returning id`, [coach, HASH_A]);
      h.check("a coach saves a recipe with tags, a main protein, reference macros and a hash", !ok.error && !!ok.rows?.[0]?.id, JSON.stringify(ok));
      const id = ok.rows?.[0]?.id;
      const line = await tryQ(db, `insert into public.recipe_ingredients (recipe_id, label, role, protein_per_100g, grams_ref) values ($1, 'Chicken breast', 'protein_source', 23, 150) returning grams_ref`, [id]);
      h.check("a line carries reference grams", !line.error && Number(line.rows?.[0]?.grams_ref) === 150, JSON.stringify(line));
      const dup = await tryQ(db, `insert into public.recipes (created_by, name, slot, content_hash) values ($1, 'Chicken bowl again', 'lunch', $2)`, [coach, HASH_A]);
      h.check("the same content hash twice for one owner is refused (the same option saved twice is one recipe)", /recipes_owner_content_hash_uniq|duplicate key/.test(dup.error ?? ""), JSON.stringify(dup));
      const notHash = await tryQ(db, `insert into public.recipes (created_by, name, slot, content_hash) values ($1, 'Bad hash', 'lunch', 'not-a-hash')`, [coach]);
      h.check("a hash must be 64 lower-case hex characters", /recipes_content_hash_ok/.test(notHash.error ?? ""), JSON.stringify(notHash));
      const two = await tryQ(db, `insert into public.recipes (created_by, name, slot, content_hash) values ($1, 'Two recipes, no hash', 'lunch', null), ($1, 'Another, no hash', 'lunch', null)`, [coach]);
      h.check("recipes with no hash are not limited", !two.error, JSON.stringify(two));
      await h.as(coach2);
      const sameHashOther = await tryQ(db, `insert into public.recipes (created_by, name, slot, content_hash) values ($1, 'Their own bowl', 'lunch', $2)`, [coach2, HASH_A]);
      h.check("another coach may save the same fingerprint (the limit is per owner)", !sameHashOther.error, JSON.stringify(sameHashOther));

      // ---- checks on the new columns ----
      await h.as(coach);
      h.check("a bad source is refused", /recipes_source_ok/.test((await tryQ(db, `insert into public.recipes (created_by, name, source) values ($1, 'x', 'robot')`, [coach])).error ?? ""));
      h.check("'shared' is refused until sharing is built", /recipes_visibility_ok/.test((await tryQ(db, `insert into public.recipes (created_by, name, visibility) values ($1, 'x', 'shared')`, [coach])).error ?? ""));
      h.check("reference grams must be above zero and at most 2000", /grams_ref_ok/.test((await tryQ(db, `insert into public.recipe_ingredients (recipe_id, label, role, grams_ref) values ($1, 'x', 'fixed', 0)`, [id])).error ?? "") && /grams_ref_ok/.test((await tryQ(db, `insert into public.recipe_ingredients (recipe_id, label, role, grams_ref) values ($1, 'x', 'fixed', 2500)`, [id])).error ?? ""));
      h.check("reference macros must be an object", /reference_macros_ok/.test((await tryQ(db, `insert into public.recipes (created_by, name, reference_macros) values ($1, 'x', '[1,2]'::jsonb)`, [coach])).error ?? ""));
      h.check("a main protein over 60 characters is refused", /main_protein_ok/.test((await tryQ(db, `insert into public.recipes (created_by, name, main_protein) values ($1, 'x', repeat('p', 61))`, [coach])).error ?? ""));

      // ---- AI recipes: measured lines must be matched to a real food ----
      await h.asSuper();
      await db.query(`insert into public.usda_foods (fdc_id, description, data_type) values (175167, 'Fish, salmon, Atlantic, farmed, raw', 'SR Legacy') on conflict do nothing`);
      await h.as(coach);
      const ai = await tryQ(db, `insert into public.recipes (created_by, name, slot, source, content_hash, verified_at) values ($1, 'AI salmon bowl', 'dinner', 'ai', $2, now()) returning id`, [coach, HASH_B]);
      const aiId = ai.rows?.[0]?.id;
      const unmatched = await tryQ(db, `insert into public.recipe_ingredients (recipe_id, label, role, protein_per_100g, grams_ref, sort_order) values ($1, 'Salmon', 'protein_source', 20, 150, 0)`, [aiId]);
      h.check("a measured line of an AI recipe with no matched food is refused", /must be matched to a real food/.test(unmatched.error ?? ""), JSON.stringify(unmatched));
      const matched = await tryQ(db, `insert into public.recipe_ingredients (recipe_id, label, role, protein_per_100g, grams_ref, usda_fdc_id, sort_order) values ($1, 'Salmon', 'protein_source', 20, 150, 175167, 0)`, [aiId]);
      h.check("the same line with a matched food is accepted", !matched.error, JSON.stringify(matched));
      const fixed = await tryQ(db, `insert into public.recipe_ingredients (recipe_id, label, role, fixed_display_text, sort_order) values ($1, 'Greens', 'fixed', '1 cup greens', 1)`, [aiId]);
      h.check("a fixed text line of an AI recipe needs no matched food", !fixed.error, JSON.stringify(fixed));
      const coachUnmatched = await tryQ(db, `insert into public.recipe_ingredients (recipe_id, label, role, protein_per_100g, grams_ref, sort_order) values ($1, 'Rice', 'carb_source', 0, 100, 5)`, [id]);
      h.check("a coach's own recipe still needs no matched food", !coachUnmatched.error, JSON.stringify(coachUnmatched));
      const flip = await tryQ(db, `update public.recipe_ingredients set usda_fdc_id = null where recipe_id = $1 and label = 'Salmon'`, [aiId]);
      h.check("an AI line cannot lose its matched food afterwards", /must be matched to a real food/.test(flip.error ?? ""), JSON.stringify(flip));

      // ---- who can read: unchanged ----
      await h.as(client);
      const clientSees = await tryQ(db, `select name, source, content_hash from public.recipes where created_by = $1 and name = 'Chicken bowl'`, [coach]);
      h.check("a client in the coach's group still reads the coach's recipes, including the new columns", clientSees.rows?.length === 1 && clientSees.rows[0].source === "coach", JSON.stringify(clientSees));
      const clientWrite = await tryQ(db, `insert into public.recipes (created_by, name) values ($1, 'client recipe in the coach''s name')`, [coach]);
      const clientEdit = await tryQ(db, `update public.recipes set name = 'renamed' where created_by = $1 returning 1`, [coach]);
      h.check("a client cannot add or change a coach's recipes", !!clientWrite.error && (clientEdit.rows ?? []).length === 0, JSON.stringify({ clientWrite, clientEdit }));
      await h.as(other);
      h.check("someone outside the group sees none of them", (await tryQ(db, `select 1 from public.recipes where created_by = $1`, [coach])).rows?.length === 0);
      await h.as(coach2);
      h.check("another coach sees none of them", (await tryQ(db, `select 1 from public.recipes where created_by = $1`, [coach])).rows?.length === 0);
      await h.asSuper();
      const open = await h.rows(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'guard_ai_recipe_ingredient' and p.prorettype <> 'trigger'::regtype`);
      h.check("the new function is a trigger function (nobody can call it directly)", open.length === 0);
    },
  },
};
