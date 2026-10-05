// Small additive columns: 0240 guide dismissal follows the person, 0241 program label and order, 0249 the coach's completion message.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0240 guide dismissal, 0241 program label/order, 0249 completion message",
  migrations: ["0240", "0241", "0249"],
  phases: {
    async "0241"({ db, h }) {
      const coach = await h.user("Prog Coach");
      const ann = await h.user("Prog Ann");
      const bo = await h.user("Prog Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Prog group");
      await h.member(group, ann);
      await h.asSuper();
      const p1 = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'Main', $2) returning id`, [group, coach])).rows[0].id;
      const p2 = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'Mobility', $2) returning id`, [group, coach])).rows[0].id;
      const row = await h.one(`select label, sort_order from public.programs where id = $1`, [p1]);
      h.check("0241: a program with no label or order reads as null, null (shows by its own name, oldest first, as before)", row.label === null && row.sort_order === null);
      await h.as(coach);
      h.check("0241: the coach can label and order programs", (await tryQ(db, `update public.programs set label = 'Mobility', sort_order = 2 where id = $1 returning id`, [p2])).rows?.length === 1);
      await h.as(ann);
      const seen = await h.rows(`select label, sort_order from public.programs where id = $1`, [p2]);
      h.check("0241: a client in the group reads the label and order", seen[0]?.label === "Mobility" && seen[0].sort_order === 2);
      const mine = await tryQ(db, `update public.programs set label = 'Hacked' where id = $1 returning 1`, [p2]);
      h.check("0241: a client cannot change them", mine.error || mine.rows.length === 0);
      await h.as(bo);
      h.check("0241: someone outside the group does not see the program", (await h.rows(`select 1 from public.programs where id = $1`, [p2])).length === 0);
    },

    async "0240"({ db, h }) {
      const ann = await h.user("Guide Ann");
      const bo = await h.user("Guide Bo");
      await h.asSuper();
      h.check("0240: nobody starts with the guide dismissed", (await h.one(`select guide_dismissed_at from public.profiles where id = $1`, [ann])).guide_dismissed_at === null);
      await h.as(ann);
      h.check("0240: a person can dismiss the guide on their own profile", (await tryQ(db, `update public.profiles set guide_dismissed_at = now() where id = $1 returning guide_dismissed_at`, [ann])).rows?.[0]?.guide_dismissed_at !== null);
      const other = await tryQ(db, `update public.profiles set guide_dismissed_at = now() where id = $1 returning 1`, [bo]);
      await h.asSuper();
      h.check("0240: ...but not on someone else's", (other.error || other.rows.length === 0) && (await h.one(`select guide_dismissed_at from public.profiles where id = $1`, [bo])).guide_dismissed_at === null);
    },

    async "0249"({ db, h }) {
      const coach = await h.user("Msg Coach");
      const ann = await h.user("Msg Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Msg group");
      await h.member(group, ann);
      await h.asSuper();
      await db.query(`insert into public.coach_profiles (coach_id) values ($1) on conflict do nothing`, [coach]);
      await h.as(coach);
      const ok = await tryQ(db, `update public.coach_profiles set completion_message = 'Great work today.' where coach_id = $1 returning completion_message`, [coach]);
      h.check("0249: the coach can set their completion message", ok.rows?.[0]?.completion_message === "Great work today.", JSON.stringify(ok));
      h.check("0249: 280 characters is allowed", !!(await tryQ(db, `update public.coach_profiles set completion_message = $2 where coach_id = $1 returning 1`, [coach, "x".repeat(280)])).rows);
      h.check("0249: 281 characters is refused", !!(await tryQ(db, `update public.coach_profiles set completion_message = $2 where coach_id = $1`, [coach, "x".repeat(281)])).error);
      h.check("0249: it can be cleared", (await tryQ(db, `update public.coach_profiles set completion_message = null where coach_id = $1 returning completion_message`, [coach])).rows?.[0]?.completion_message === null);
      await h.as(ann);
      const mine = await tryQ(db, `update public.coach_profiles set completion_message = 'I am the coach now' where coach_id = $1 returning 1`, [coach]);
      await h.asSuper();
      h.check("0249: a client cannot write their coach's message", (mine.error || mine.rows.length === 0) && (await h.one(`select completion_message from public.coach_profiles where coach_id = $1`, [coach])).completion_message === null);
    },
  },
};
