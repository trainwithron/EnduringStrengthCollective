// 0286: a client can star a food they logged (kind 'food', with the macros frozen as they were) and log it again in one tap. Private to the client. The old
// recipe hearts keep working and are not food favorites.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0286 favorite foods (private, frozen macros)",
  migrations: ["0286"],
  phases: {
    async "0285"({ db, h }) {
      const c = await h.one(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'recipe_favorites' and column_name = 'kind'`);
      h.check("baseline: a favorite is only a recipe id (what 0286 adds food favorites to)", c.n === 0, JSON.stringify(c));
    },

    async "0286"({ db, h }) {
      const coach = await h.user("V1 Coach");
      const ann = await h.user("V1 Ann");
      const bob = await h.user("V1 Bob");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "V1 group");
      await h.member(group, ann);
      await h.member(group, bob);
      await h.asSuper();

      const star = (who, key, label, cal, extra = "") => tryQ(db, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label, calories, protein_g, carbs_g, fat_g) values ($1, $2, 'food', $3, $4, 30, 40, 10)${extra}`, [who, key, label, cal]);

      await h.as(ann);
      const ok = await star(ann, "food:chipotle bowl", "Chipotle bowl", 650);
      const dup = await star(ann, "food:chipotle bowl", "Chipotle bowl", 650);
      const noLabel = await tryQ(db, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label, calories) values ($1, 'food:x', 'food', '  ', 100)`, [ann]);
      const noCal = await tryQ(db, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label) values ($1, 'food:y', 'food', 'Y')`, [ann]);
      const negative = await star(ann, "food:z", "Z", -5);
      const badKind = await tryQ(db, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label, calories) values ($1, 'q', 'meal', 'Q', 1)`, [ann]);
      const heart = await tryQ(db, `insert into public.recipe_favorites (profile_id, recipe_id) values ($1, 'l_chicken_rice')`, [ann]);
      const other = await star(bob, "food:chipotle bowl", "Bob's bowl", 500);
      const forged = await star(bob, "food:forged", "Forged", 100); // as ann inserting for bob: refused below
      await h.asSuper();
      h.check("a client stars a food with its macros", !ok.error, JSON.stringify(ok));
      h.check("the same food cannot be starred twice", !!dup.error, JSON.stringify(dup));
      h.check("a food favorite needs a label and calories, never negative, and the kind must be recipe or food", !!noLabel.error && !!noCal.error && !!negative.error && !!badKind.error, JSON.stringify({ noLabel, noCal, negative, badKind }));
      h.check("the old recipe hearts still work and are kind recipe", !heart.error && (await h.one(`select kind from public.recipe_favorites where profile_id = $1 and recipe_id = 'l_chicken_rice'`, [ann])).kind === "recipe", JSON.stringify(heart));
      h.check("a client cannot star a food for someone else", !!other.error && !!forged.error, JSON.stringify({ other, forged }));

      await h.as(bob);
      const bobSees = await tryQ(db, `select count(*)::int as n from public.recipe_favorites where profile_id = $1`, [ann]);
      await h.as(coach);
      const coachSees = await tryQ(db, `select count(*)::int as n from public.recipe_favorites where profile_id = $1`, [ann]);
      await h.as(ann);
      const annSees = await tryQ(db, `select count(*)::int as n from public.recipe_favorites where kind = 'food'`);
      await h.asSuper();
      h.check("only the client sees their favorites: not another client, not their coach", bobSees.rows?.[0]?.n === 0 && coachSees.rows?.[0]?.n === 0 && annSees.rows?.[0]?.n === 1, JSON.stringify({ bobSees, coachSees, annSees }));

      // frozen: the snapshot is what was starred; there is nothing that rewrites it
      const snap = await h.one(`select calories::int as c, protein_g::int as p from public.recipe_favorites where profile_id = $1 and kind = 'food'`, [ann]);
      h.check("the macros are stored as starred", snap.c === 650 && snap.p === 30, JSON.stringify(snap));

      // the cap
      await h.as(ann);
      let capError = null;
      for (let i = 0; i < 70 && !capError; i++) {
        const r = await star(ann, `food:item${i}`, `Item ${i}`, 100);
        if (r.error) capError = r.error;
      }
      await h.asSuper();
      const total = await h.one(`select count(*)::int as n from public.recipe_favorites where profile_id = $1 and kind = 'food'`, [ann]);
      await h.as(ann);
      await tryQ(db, `insert into public.recipe_favorites (profile_id, recipe_id) values ($1, 'a_heart')`, [ann]);
      const convert = await tryQ(db, `update public.recipe_favorites set kind = 'food', label = 'Sneaky', calories = 100 where profile_id = $1 and recipe_id = 'a_heart'`, [ann]);
      const negMacro = await tryQ(db, `insert into public.recipe_favorites (profile_id, recipe_id, kind, label, calories, protein_g) values ($1, 'food:neg', 'food', 'Neg', 100, -1)`, [ann]);
      await h.asSuper();
      h.check("a heart cannot be changed into a food favorite to get past the 60, and macros cannot be negative", /up to 60/.test(convert.error ?? "") && !!negMacro.error, JSON.stringify({ convert, negMacro }));
      h.check("at most 60 favorite foods per client, refused with a plain message", /up to 60/.test(capError ?? "") && total.n === 60, JSON.stringify({ capError, total }));
    },
  },
};
