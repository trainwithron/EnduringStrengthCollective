// 0306: the client is told (fixed wording) when their daily calorie target changes, so the "are you happy with your meal plan?" question can be asked. New notification type added to
// the list the database already has.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const dayKey = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export default {
  name: "0306 target change notice",
  migrations: ["0306"],
  phases: {
    async "0306"({ db, h }) {
      const coach = await h.user("TC Coach");
      const ann = await h.user("TC Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "TC group");
      await h.member(group, ann);

      await h.asSuper();
      const def = await h.one(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_type_check'`);
      h.check("the new notification type is in the list, and the older types are still there", /nutrition_target_changed/.test(def.def) && /nutrition_prompt_answered/.test(def.def) && /'comment'/.test(def.def), def.def);

      const put = async (offset, calories) => {
        await h.as(coach);
        return tryQ(db, `insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g, created_by) values ($1, $2, $3, $4, 150, 200, 60, $5) returning calories`, [ann, group, dayKey(offset), calories, coach]);
      };
      const notices = async () => {
        await h.asSuper();
        return h.rows(`select profile_id, type, body, link_path, read_at is not null as is_read from public.notifications where type = 'nutrition_target_changed' order by created_at`);
      };

      const first = await put(-3, 2000);
      h.check("the coach can set a client's first target", !first.error, JSON.stringify(first));
      h.check("a client's very first target tells nobody (there is no plan to be happy about yet)", (await notices()).length === 0);

      const second = await put(0, 2200);
      h.check("the coach applies a new target", !second.error, JSON.stringify(second));
      const n2 = await notices();
      h.check("the CLIENT is told, once, with fixed wording and a link to their Nutrition page", n2.length === 1 && n2[0].profile_id === ann && n2[0].link_path === `/groups/${group}/nutrition` && /target changed/.test(n2[0].body) && !/2200|2000/.test(n2[0].body), JSON.stringify(n2));
      h.check("the coach is not sent this notice", !n2.some((n) => n.profile_id === coach));

      await put(1, 2200);
      h.check("a row that leaves the calories the same tells nobody", (await notices()).length === 1);

      await put(2, 2300);
      h.check("another change while the first notice is unread does not send a second one", (await notices()).length === 1);

      await h.asSuper();
      await db.query(`update public.notifications set read_at = now() where profile_id = $1 and type = 'nutrition_target_changed'`, [ann]);
      await put(3, 2400);
      h.check("once it has been read, the next change tells them again", (await notices()).length === 2);

      await put(-20, 1500);
      h.check("a correction dated well in the past is not a new target", (await notices()).length === 2);

      await h.as(ann);
      const mine = await tryQ(db, `select count(*)::int as n from public.notifications where type = 'nutrition_target_changed'`);
      h.check("the client can read their own notices", mine.rows?.[0]?.n === 2, JSON.stringify(mine));
    },
  },
};
