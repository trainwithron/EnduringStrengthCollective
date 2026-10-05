// 0253 (applied last, after the share page reads with the service role): the signed-out visitor can no longer read shared-workout tables
// directly. 0254: who may change client tags, and who may assign the tag that gates revenue splitting.
async function anonCounts(db, h) {
  const out = {};
  for (const t of ["posts", "workout_logs", "profiles", "groups", "session_exercises", "set_logs", "organizations"]) {
    await h.as(null);
    try {
      out[t] = (await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n;
    } catch (e) {
      out[t] = /permission denied/i.test(String(e.message)) ? 0 : `error: ${String(e.message).split("\n")[0]}`;
    }
  }
  return out;
}

export default {
  name: "0253 anon share policies closed; 0254 client tag write rules",
  migrations: ["0253", "0254"],
  phases: {
    // Right before 0253: seed one shared workout, show the signed-out visitor can read it straight from the tables.
    async "0252"({ db, h, state }) {
      const coach = await h.user("Share Coach");
      const ann = await h.user("Share Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Share group");
      await h.member(group, ann);
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id`, [group, coach])).rows[0].id;
      const workout = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day', 1) returning id`, [prog, group])).rows[0].id;
      const sess = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, status) values ($1, $2, $3, 'completed') returning id`, [workout, group, ann])).rows[0].id;
      const se = (await db.query(`insert into public.session_exercises (session_id, exercise_name) values ($1, 'Squat') returning id`, [sess])).rows[0].id;
      await db.query(`insert into public.set_logs (session_exercise_id, set_order, weight, reps, status) values ($1, 1, 100, 5, 'completed')`, [se]);
      const log = (await db.query(`insert into public.workout_logs (session_id, athlete_id, group_id, workout_id, total_volume, total_sets_completed) values ($1, $2, $3, $4, 500, 1) returning id`, [sess, ann, group, workout])).rows[0].id;
      const post = (await db.query(`insert into public.posts (group_id, author_id, post_type, workout_log_id) values ($1, $2, 'workout_summary', $3) returning id`, [group, ann, log])).rows[0].id;
      Object.assign(state, { coach, ann, group, post, log });
      const before = await anonCounts(db, h);
      state.before = before;
      h.check("baseline: before 0253 a signed-out visitor can list shared posts, logs, sets and group names straight from the database",
        before.posts > 0 && before.workout_logs > 0 && before.set_logs > 0 && before.groups > 0 && before.session_exercises > 0, JSON.stringify(before));
    },

    async "0253"({ db, h, state }) {
      const after = await anonCounts(db, h);
      h.check("after 0253 the signed-out visitor reads nothing from any of the seven tables", Object.values(after).every((n) => n === 0), JSON.stringify(after));
      await h.asService();
      const svc = {};
      for (const t of ["posts", "workout_logs", "profiles", "groups", "session_exercises", "set_logs", "organizations"]) svc[t] = (await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n;
      h.check("the share page's reads (service role) still see everything it needs", Object.values(svc).every((n) => n > 0), JSON.stringify(svc));
      const card = await h.one(`select p.id, wl.total_volume, pr.full_name, g.name from public.posts p join public.workout_logs wl on wl.id = p.workout_log_id join public.profiles pr on pr.id = p.author_id join public.groups g on g.id = p.group_id where p.id = $1`, [state.post]);
      h.check("...including the joins behind the card for one named post", !!card && Number(card.total_volume) === 500);
      await h.as(state.ann);
      h.check("a signed-in athlete still reads their own group's posts", (await h.rows(`select 1 from public.posts where group_id = $1`, [state.group])).length >= 1);
      await h.as(await h.user("Stranger"));
      h.check("a signed-in stranger does not read another group's posts", (await h.rows(`select 1 from public.posts where group_id = $1`, [state.group])).length === 0);
      await h.as(null);
      h.check("the signed-out visitor still cannot call the invite function (join path needs a login)", await db.query(`select public.join_group_with_invite('X')`).then(() => false, (e) => /permission denied/i.test(String(e.message))));
    },

    async "0254"({ db, h, state }) {
      const owner = await h.user("Tag Owner");
      const admin = await h.user("Tag Admin");
      const coach = await h.user("Tag Coach");
      const outsider = await h.user("Tag Outsider");
      const org = await h.org(owner);
      await h.orgMember(org, admin, "admin");
      await h.orgMember(org, coach, "coach");
      const group = await h.group(org, coach, "team", "Tagged");
      const inOrg = await h.user("Tag Client");
      await h.member(group, inOrg);
      const otherOrgCoach = await h.user("Tag Other");
      const otherOrg = await h.org(otherOrgCoach);
      const otherGroup = await h.group(otherOrg, otherOrgCoach, "team", "Elsewhere");
      const foreign = await h.user("Tag Foreign Client");
      await h.member(otherGroup, foreign);

      const asTry = async (uid, sql, params) => { await h.as(uid); try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message) }; } };
      const tagId = async (name) => { await h.asSuper(); return (await h.one(`select id from public.client_tags where organization_id = $1 and name = $2`, [org, name]))?.id; };

      // create
      const mk = (uid, name, gates) => asTry(uid, `insert into public.client_tags (organization_id, name, created_by, gates_revenue_split) values ($1, $2, $3, $4) returning id`, [org, name, uid, gates]);
      h.check("an owner can create a tag", !!(await mk(owner, "owner-tag", false)).rows);
      h.check("an admin can create a tag, including one that gates revenue splitting", !!(await mk(admin, "split", true)).rows);
      h.check("a trainer (coach) cannot create a tag", !!(await mk(coach, "coach-tag", false)).error);
      h.check("someone outside the organization cannot create a tag", !!(await mk(outsider, "outsider-tag", false)).error);
      await mk(owner, "plain", false);

      // update / delete
      const split = await tagId("split");
      const plain = await tagId("plain");
      let r = await asTry(coach, `update public.client_tags set gates_revenue_split = false where id = $1 returning id`, [split]);
      h.check("a trainer cannot flip the revenue-split flag", (r.error || r.rows.length === 0) && (await h.asSuper(), (await h.one(`select gates_revenue_split from public.client_tags where id = $1`, [split])).gates_revenue_split === true));
      r = await asTry(coach, `delete from public.client_tags where id = $1 returning id`, [plain]);
      h.check("a trainer cannot delete a tag", (r.error || r.rows.length === 0) && !!(await tagId("plain")));
      r = await asTry(admin, `update public.client_tags set name = 'plain2' where id = $1 returning id`, [plain]);
      h.check("an admin can rename a tag", r.rows?.length === 1);
      h.check("any member can see the tags", (await (async () => { await h.as(coach); return h.rows(`select 1 from public.client_tags where organization_id = $1`, [org]); })()).length >= 2);
      h.check("someone outside the organization cannot see the tags", (await (async () => { await h.as(outsider); return h.rows(`select 1 from public.client_tags where organization_id = $1`, [org]); })()).length === 0);

      // assignments
      const assign = (uid, tag, athlete) => asTry(uid, `insert into public.client_tag_assignments (tag_id, athlete_id) values ($1, $2) returning tag_id`, [tag, athlete]);
      const plain2 = await tagId("plain2");
      h.check("a trainer can tag a client in their organization with an ordinary tag", !!(await assign(coach, plain2, inOrg)).rows);
      h.check("a trainer cannot assign the tag that gates revenue splitting", !!(await assign(coach, split, inOrg)).error);
      { const ra = await assign(owner, split, inOrg); h.check("an owner can assign the revenue-splitting tag", !!ra.rows, ra.error); }
      h.check("a person who is not in any group of the organization cannot be tagged", !!(await assign(owner, plain2, foreign)).error);
      r = await asTry(coach, `delete from public.client_tag_assignments where tag_id = $1 and athlete_id = $2 returning 1`, [split, inOrg]);
      h.check("a trainer cannot remove the revenue-splitting tag from a client", (r.error || r.rows.length === 0) && (await h.asSuper(), (await h.one(`select count(*)::int as n from public.client_tag_assignments where tag_id = $1 and athlete_id = $2`, [split, inOrg])).n === 1));
      r = await asTry(coach, `delete from public.client_tag_assignments where tag_id = $1 and athlete_id = $2 returning 1`, [plain2, inOrg]);
      h.check("a trainer can remove an ordinary tag", r.rows?.length === 1);
      r = await asTry(admin, `delete from public.client_tag_assignments where tag_id = $1 and athlete_id = $2 returning 1`, [split, inOrg]);
      h.check("an admin can remove the revenue-splitting tag", r.rows?.length === 1);
    },
  },
};
