// 0414: a group setting for post-workout cards and PR notices. One nullable column on groups; empty means the default. A coach of the group can change it; a client cannot.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0414 Post-workout cards setting",
  migrations: ["0414"],
  phases: {
    async "0414"({ db, h }) {
      const owner = await h.user("PC Owner");
      const coach = await h.user("PC Coach");
      const ann = await h.user("PC Ann");
      const org = await h.org(owner, "PC Gym");
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, coach, "team", "PC team");
      await h.member(g, ann);

      await h.asSuper();
      const col = (await db.query(`select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'post_workout_cards'`)).rows[0];
      h.check("the column is there, a boolean that can be empty", col?.data_type === "boolean" && col?.is_nullable === "YES", JSON.stringify(col));
      h.check("a group starts empty (the default applies)", (await db.query(`select post_workout_cards from public.groups where id = $1`, [g])).rows[0].post_workout_cards === null);

      await h.as(coach);
      let r = await tryQ(db, `update public.groups set post_workout_cards = true where id = $1 returning post_workout_cards`, [g]);
      h.check("the group's coach can switch it on" + (r.error ? ": " + r.error : ""), r.rows?.[0]?.post_workout_cards === true);
      r = await tryQ(db, `update public.groups set post_workout_cards = false where id = $1 returning post_workout_cards`, [g]);
      h.check("and off", r.rows?.[0]?.post_workout_cards === false);

      await h.as(ann);
      r = await tryQ(db, `update public.groups set post_workout_cards = true where id = $1 returning id`, [g]);
      h.check("a client cannot change it", !!r.error || (r.rows ?? []).length === 0, JSON.stringify(r));
      await h.asSuper();
      h.check("and it is still what the coach set", (await db.query(`select post_workout_cards from public.groups where id = $1`, [g])).rows[0].post_workout_cards === false);
    },
  },
};
