// 0307: the target-change notice function is closed to the public and signed-in users (an internal function), and the trigger still fires.
const dayKey = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export default {
  name: "0307 target change notice function closed",
  migrations: ["0307"],
  phases: {
    async "0307"({ db, h }) {
      const coach = await h.user("CF Coach");
      const ann = await h.user("CF Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "CF group");
      await h.member(group, ann);

      await h.asSuper();
      const open = await h.one(`select has_function_privilege('authenticated', 'public.notify_on_target_change()', 'execute') as a, has_function_privilege('anon', 'public.notify_on_target_change()', 'execute') as n`);
      h.check("the notice function can not be run by signed-in users or signed-out visitors", open.a === false && open.n === false, JSON.stringify(open));

      await h.as(coach);
      await db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g, created_by) values ($1, $2, $3, 2000, 150, 200, 60, $4)`, [ann, group, dayKey(-3), coach]);
      await db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g, created_by) values ($1, $2, $3, 2200, 150, 200, 60, $4)`, [ann, group, dayKey(0), coach]);
      await h.asSuper();
      const notices = await h.rows(`select profile_id from public.notifications where type = 'nutrition_target_changed' and group_id = '${group}'`);
      h.check("the notice still goes out when a signed-in coach applies a new target (the trigger fires without the right to run the function)", notices.length === 1 && notices[0].profile_id === ann, JSON.stringify(notices));

      await h.as(ann);
      const direct = await db.query(`select public.notify_on_target_change()`).then(() => ({ ok: true }), (e) => ({ error: String(e.message).split("\n")[0] }));
      h.check("a signed-in person calling the function directly is refused", !!direct.error, JSON.stringify(direct));
    },
  },
};
