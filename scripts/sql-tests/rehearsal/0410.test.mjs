// 0410: each message in a support thread tells the other side. The coach writing tells every platform admin (and not themselves); anyone else writing tells the coach who opened the request, with a link to their Support page.
export default {
  name: "0410 Support notices",
  migrations: ["0410"],
  phases: {
    async "0410"({ db, h }) {
      const coach = await h.user("SN Coach");
      const admin = await h.user("SN Admin");
      const admin2 = await h.user("SN Admin Two");
      const bareCoach = await h.user("SN Bare Coach");
      const org = await h.org(coach, "SN Gym");
      const org2 = await h.org(bareCoach, "SN Bare Gym");
      const g = await h.group(org, coach, "team", "SN team");
      await h.asSuper();
      await db.query(`update public.profiles set is_platform_admin = true where id = any($1::uuid[])`, [[admin, admin2]]);
      const notices = async (who, like = "%") => (await db.query(`select type, body, link_path, group_id from public.notifications where profile_id = $1 and type = 'support_reply' and body like $2 order by created_at`, [who, like])).rows;

      const kinds = (await db.query(`select pg_get_constraintdef(c.oid) as d from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass`)).rows[0].d;
      h.check("the notice list has support_reply and still has the kinds it had", kinds.includes("'support_reply'") && ["payment_received", "request_decision", "late_change", "space_invite", "email_change_requested"].every((k) => kinds.includes(`'${k}'`)), kinds);

      // ---- the coach opens a request: every platform admin is told, the coach is not
      const req = (await db.query(`insert into public.support_requests (organization_id, coach_id, subject) values ($1, $2, 'My card was charged twice') returning id`, [org, coach])).rows[0].id;
      await db.query(`insert into public.support_messages (request_id, author_id, body) values ($1, $2, 'Please help')`, [req, coach]);
      const a1 = await notices(admin);
      h.check("a platform admin is told when a coach writes", a1.length === 1 && a1[0].link_path === "/admin/support" && a1[0].body.includes("SN Coach") && a1[0].body.includes("My card was charged twice"), JSON.stringify(a1));
      h.check("so is every other platform admin", (await notices(admin2)).length === 1);
      h.check("the coach is not told about their own message", (await notices(coach)).length === 0);

      // ---- the admin replies: the coach is told, linking to their Support page; the admin is not
      await db.query(`insert into public.support_messages (request_id, author_id, body) values ($1, $2, 'Looking now')`, [req, admin]);
      const c1 = await notices(coach);
      h.check("the coach is told when support replies, with a link to their Support page", c1.length === 1 && c1[0].link_path === `/groups/${g}/business/support` && c1[0].group_id === g && c1[0].body === "Support replied to your request: My card was charged twice", JSON.stringify(c1));
      h.check("the admin who replied is not told about their own reply", (await notices(admin, "Support replied%")).length === 0);

      // ---- a follow-up from the coach tells the admins again
      await db.query(`insert into public.support_messages (request_id, author_id, body) values ($1, $2, 'Any news?')`, [req, coach]);
      h.check("a follow-up tells the admins again", (await notices(admin)).length === 2);

      // ---- a coach with no group of their own in that organization still gets the reply, linking to the dashboard
      const req2 = (await db.query(`insert into public.support_requests (organization_id, coach_id, subject) values ($1, $2, 'Question') returning id`, [org2, bareCoach])).rows[0].id;
      await db.query(`delete from public.group_memberships where profile_id = $1`, [bareCoach]);
      await db.query(`insert into public.support_messages (request_id, author_id, body) values ($1, $2, 'Hello')`, [req2, admin]);
      const b1 = await notices(bareCoach, "Support replied%");
      h.check("a coach with no group still gets the reply, linking to the dashboard", b1.length === 1 && b1[0].link_path === "/dashboard" && b1[0].group_id === null, JSON.stringify(b1));

      // ---- an ordinary person gets nothing, and nobody can call the trigger function
      const stranger = await h.user("SN Stranger");
      h.check("someone not involved is told nothing", (await notices(stranger)).length === 0);
      await h.as(coach);
      let refused = false;
      try {
        await db.query(`select public.notify_on_support_message()`);
      } catch {
        refused = true;
      }
      await h.asSuper();
      h.check("a signed-in person cannot call the trigger function", refused);
    },
  },
};
