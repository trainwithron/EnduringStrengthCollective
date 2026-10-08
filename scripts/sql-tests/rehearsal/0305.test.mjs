// 0305: the AI top-up draws record. Server only; one row per organization and month; sane amounts; removed with the organization.
import { toBatchSql } from "../../usda-batch-lib.mjs";

const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0305 AI top-up draws",
  migrations: ["0305"],
  phases: {
    async "0305"({ db, h }) {
      const owner = await h.user("TD Owner");
      const org = await h.org(owner);
      await h.group(org, owner, "team", "TD group");
      await h.asService();
      const first = await tryQ(db, `insert into public.ai_topup_draws (organization_id, month, usd_drawn) values ($1, '2026-09-01', 4) returning usd_drawn::float as v`, [org]);
      h.check("the server records what a month drew from the balance", !first.error && first.rows?.[0]?.v === 4, JSON.stringify(first));
      const upsert = await tryQ(db, `insert into public.ai_topup_draws (organization_id, month, usd_drawn) values ($1, '2026-09-01', 6) on conflict (organization_id, month) do update set usd_drawn = excluded.usd_drawn returning usd_drawn::float as v`, [org]);
      h.check("there is one row per organization and month (a later write updates it)", !upsert.error && upsert.rows?.[0]?.v === 6, JSON.stringify(upsert));
      const neg = await tryQ(db, `insert into public.ai_topup_draws (organization_id, month, usd_drawn) values ($1, '2026-10-01', -1)`, [org]);
      h.check("a negative draw is refused", !!neg.error, JSON.stringify(neg));
      const huge = await tryQ(db, `insert into public.ai_topup_draws (organization_id, month, usd_drawn) values ($1, '2026-10-01', 1000000)`, [org]);
      h.check("an absurd draw is refused", !!huge.error, JSON.stringify(huge));

      await h.as(owner);
      const read = await tryQ(db, `select * from public.ai_topup_draws`);
      h.check("the organization's own owner cannot read it from the app", !!read.error || (read.rows?.length ?? 0) === 0, JSON.stringify(read));
      const write = await tryQ(db, `insert into public.ai_topup_draws (organization_id, month, usd_drawn) values ($1, '2026-11-01', 1)`, [org]);
      h.check("or write it", !!write.error, JSON.stringify(write));

      // ---- the USDA load batches (scripts/usda-import.mjs): one statement each, atomic, and a finished batch is skipped when run again ----
      await h.asSuper();
      const foods = new Map([[991001, { fdc_id: 991001, description: "Test onions, raw", data_type: "SR Legacy", food_category: "Vegetables" }]]);
      const good = toBatchSql("rehearsal-load-001", foods, [{ fdc_id: 991001, nutrient_key: "copper_mcg", amount_per_100g: 40 }, { fdc_id: 991001, nutrient_key: "kcal", amount_per_100g: 40 }], [{ fdc_id: 991001, seq: 1, description: "1 cup, chopped", gram_weight: 160 }]);
      await db.exec(good);
      const loaded = await h.one(`select (select count(*)::int from public.usda_foods where fdc_id = 991001) as foods, (select count(*)::int from public.usda_food_nutrients where fdc_id = 991001) as nutrients, (select count(*)::int from public.usda_food_portions where fdc_id = 991001) as portions, (select rows_loaded from public.usda_load_batches where name = 'rehearsal-load-001') as marker`);
      h.check("a batch loads the foods, every nutrient and the portions, and records itself", loaded.foods === 1 && loaded.nutrients === 2 && loaded.portions === 1 && loaded.marker === 4, JSON.stringify(loaded));
      await db.query(`update public.usda_food_nutrients set amount_per_100g = 1 where fdc_id = 991001 and nutrient_key = 'kcal'`);
      await db.exec(good);
      const again = await h.one(`select amount_per_100g::float as v from public.usda_food_nutrients where fdc_id = 991001 and nutrient_key = 'kcal'`);
      h.check("running a finished batch again does nothing (its marker is there)", again.v === 1, JSON.stringify(again));
      const badFoods = new Map([[991002, { fdc_id: 991002, description: "Test half-loaded food", data_type: "SR Legacy", food_category: null }]]);
      const bad = toBatchSql("rehearsal-load-002", badFoods, [{ fdc_id: 991002, nutrient_key: "kcal", amount_per_100g: 10 }], [{ fdc_id: 991002, seq: 1, description: "1 cup", gram_weight: 0 }]);
      const failed = await tryQ(db, bad);
      const half = await h.one(`select (select count(*)::int from public.usda_foods where fdc_id = 991002) as foods, (select count(*)::int from public.usda_food_nutrients where fdc_id = 991002) as nutrients, (select count(*)::int from public.usda_load_batches where name = 'rehearsal-load-002') as marker`);
      h.check("a batch with one bad row loads NOTHING (no food, no nutrient, no marker): a half-loaded batch cannot exist", !!failed.error && half.foods === 0 && half.nutrients === 0 && half.marker === 0, JSON.stringify({ failed, half }));
      // add mode leaves a value that is already there alone (the foods the app relies on cannot shift); a listed refresh key is the one exception
      await db.query(`update public.usda_food_nutrients set amount_per_100g = 40 where fdc_id = 991001 and nutrient_key = 'kcal'`);
      await db.query(`insert into public.usda_food_nutrients (fdc_id, nutrient_key, amount_per_100g) values (991001, 'folate_mcg', 11) on conflict do nothing`);
      const addBatch = toBatchSql("rehearsal-load-003", foods, [{ fdc_id: 991001, nutrient_key: "kcal", amount_per_100g: 999 }, { fdc_id: 991001, nutrient_key: "folate_mcg", amount_per_100g: 22 }, { fdc_id: 991001, nutrient_key: "b6_mg", amount_per_100g: 0.1 }], [], { mode: "add", refreshKeys: ["folate_mcg"] });
      await db.exec(addBatch);
      const added = await h.rows(`select nutrient_key, amount_per_100g::float as v from public.usda_food_nutrients where fdc_id = 991001 order by nutrient_key`);
      const vOf = (k) => added.find((r) => r.nutrient_key === k)?.v;
      h.check("add mode: an existing value stays as it was, a listed refresh key is updated, and a missing key is added", vOf("kcal") === 40 && vOf("folate_mcg") === 22 && vOf("b6_mg") === 0.1, JSON.stringify(added));
      await db.query(`delete from public.usda_load_batches where name = 'rehearsal-load-003'`);
      await db.query(`delete from public.usda_foods where fdc_id = 991001`);
      await db.query(`delete from public.usda_load_batches where name = 'rehearsal-load-001'`);

      await h.asSuper();
      await db.query(`delete from public.organizations where id = $1`, [org]).catch(() => {});
      const left = await h.one(`select count(*)::int as n from public.ai_topup_draws where organization_id = $1`, [org]);
      h.check("deleting the organization removes its records", left.n === 0, JSON.stringify(left));
    },
  },
};
