// 0411: report a post or comment, block a member. Blocks are the blocker's own. A report is filed only by a member of that group, never against themselves, never twice open; the group's coaches read it and are told; the person
// reported never sees who reported; only a coach marks it handled.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0411 Report and block",
  migrations: ["0411"],
  phases: {
    async "0411"({ db, h }) {
      const coach = await h.user("RB Coach");
      const a = await h.user("RB Ann");
      const b = await h.user("RB Bo");
      const outsider = await h.user("RB Outsider");
      const org = await h.org(coach, "RB Gym");
      const g = await h.group(org, coach, "team", "RB team");
      await h.member(g, a);
      await h.member(g, b);
      await h.asSuper();
      const post = (await db.query(`insert into public.posts (group_id, author_id, post_type, channel, body) values ($1, $2, 'user_post', 'general', 'a post by Bo') returning id`, [g, b])).rows[0].id;
      const own = (await db.query(`insert into public.posts (group_id, author_id, post_type, channel, body) values ($1, $2, 'user_post', 'general', 'a post by Ann') returning id`, [g, a])).rows[0].id;
      const comment = (await db.query(`insert into public.comments (post_id, group_id, author_id, body) values ($1, $2, $3, 'a comment by Bo') returning id`, [own, g, b])).rows[0].id;

      const kinds = (await db.query(`select pg_get_constraintdef(c.oid) as d from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass`)).rows[0].d;
      h.check("the notice list has content_reported and still has the kinds it had", kinds.includes("'content_reported'") && ["payment_received", "request_decision", "late_change", "space_invite"].every((k) => kinds.includes(`'${k}'`)), kinds);

      // ---- report a post
      await h.as(a);
      const rep = (await db.query(`select public.report_content($1, null, 'Rude to another member') as id`, [post])).rows[0].id;
      h.check("a member reports a post in their group", !!rep);
      h.check("reporting the same thing again returns the same open report", (await db.query(`select public.report_content($1, null, 'again') as id`, [post])).rows[0].id === rep);
      h.check("they can read their own report", (await db.query(`select count(*)::int as n from public.content_reports`)).rows[0].n === 1);
      h.check("a report needs a reason", (await msg(db, `select public.report_content($1, null, '   ')`, [post])).includes("why"));
      h.check("a report names a post or a comment, not both and not neither", (await msg(db, `select public.report_content($1, $2, 'x')`, [post, comment])).length > 0 && (await msg(db, `select public.report_content(null, null, 'x')`)).length > 0);
      h.check("you cannot report your own post", (await msg(db, `select public.report_content($1, null, 'x')`, [own])).includes("your own"));
      const rc = (await db.query(`select public.report_content(null, $1, 'Mean comment') as id`, [comment])).rows[0].id;
      h.check("a comment can be reported too", !!rc);
      h.check("a browser cannot write a report directly", (await msg(db, `insert into public.content_reports (group_id, reporter_id, post_id, reason) values ($1, $2, $3, 'x')`, [g, a, post])).length > 0);

      await h.as(outsider);
      h.check("someone outside the group cannot report in it", (await msg(db, `select public.report_content($1, null, 'x')`, [post])).includes("not found"));
      h.check("and sees no reports", (await db.query(`select count(*)::int as n from public.content_reports`)).rows[0].n === 0);
      await h.as(b);
      h.check("the person reported never sees the reports against them", (await db.query(`select count(*)::int as n from public.content_reports`)).rows[0].n === 0);

      await h.as(coach);
      h.check("the coach reads the group's reports", (await db.query(`select count(*)::int as n from public.content_reports where group_id = $1`, [g])).rows[0].n === 2);
      await h.asSuper();
      const told = (await db.query(`select body, link_path from public.notifications where profile_id = $1 and type = 'content_reported' order by created_at`, [coach])).rows;
      h.check("the coach is told, with a link to the post and without the reporter's name", told.length === 2 && told[0].link_path === `/groups/${g}/feed?highlight=${post}` && !/RB Ann/.test(told[0].body), JSON.stringify(told));
      h.check("the person reported is not told", (await db.query(`select count(*)::int as n from public.notifications where profile_id = $1 and type = 'content_reported'`, [b])).rows[0].n === 0);

      // ---- only a coach handles
      await h.as(a);
      h.check("a member cannot mark a report handled", (await msg(db, `select public.handle_content_report($1)`, [rep])).includes("not found"));
      await h.as(coach);
      await db.query(`select public.handle_content_report($1)`, [rep]);
      const handled = (await db.query(`select status, handled_by from public.content_reports where id = $1`, [rep])).rows[0];
      h.check("a coach marks it handled", handled.status === "handled" && handled.handled_by === coach);
      await h.as(a);
      const again = (await db.query(`select public.report_content($1, null, 'second report after the first was handled') as id`, [post])).rows[0].id;
      h.check("after it is handled the same person can report it again", again !== rep);

      // ---- blocks
      await h.as(a);
      await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [a, b]);
      h.check("a member blocks another", (await db.query(`select count(*)::int as n from public.user_blocks`)).rows[0].n === 1);
      h.check("blocking yourself is refused", (await msg(db, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $1)`, [a])).length > 0);
      h.check("a block cannot be made for someone else", (await msg(db, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [b, coach])).length > 0);
      await h.as(b);
      h.check("the blocked person cannot see that they are blocked", (await db.query(`select count(*)::int as n from public.user_blocks`)).rows[0].n === 0);
      await h.as(coach);
      h.check("nor can a coach", (await db.query(`select count(*)::int as n from public.user_blocks`)).rows[0].n === 0);
      await h.as(a);
      await db.query(`delete from public.user_blocks where blocker_id = $1 and blocked_id = $2`, [a, b]);
      h.check("and a block can be taken off", (await db.query(`select count(*)::int as n from public.user_blocks`)).rows[0].n === 0);
      await h.asSuper();
    },
  },
};
