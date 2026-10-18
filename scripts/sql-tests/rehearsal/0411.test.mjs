// 0411: report a post or comment, block a member. Blocks are the blocker's own. A report is filed only by a member of that group, never against themselves, never twice open, at most 20 a day. WHO handles it is a safety rule:
// the group's coaches except the person reported; no other coach -> the organization's owner and admins; none -> platform administrators. Nobody can read who reported. Removing the content keeps a copy of what was reported.
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
      const owner = await h.user("RB Owner");
      const c1 = await h.user("RB Coach One");
      const c2 = await h.user("RB Coach Two");
      const a = await h.user("RB Ann");
      const b = await h.user("RB Bo");
      const outsider = await h.user("RB Outsider");
      const admin = await h.user("RB Platform Admin");
      const org = await h.org(owner, "RB Gym");
      await h.orgMember(org, c1, "coach");
      await h.orgMember(org, c2, "coach");
      const g = await h.group(org, c1, "team", "RB team");
      await h.member(g, c2, "coach");
      await h.member(g, a);
      await h.member(g, b);
      // a group with ONE coach, in an organization with an owner who is not in the group
      const owner2 = await h.user("RB Owner Two");
      const soloCoach = await h.user("RB Solo Coach");
      const org2 = await h.org(owner2, "RB Gym Two");
      await h.orgMember(org2, soloCoach, "coach");
      const g2 = await h.group(org2, soloCoach, "team", "RB solo");
      const kid = await h.user("RB Kid");
      await h.member(g2, kid);
      // a group whose ONLY coach is also the organization's only owner
      const ownerCoach = await h.user("RB Owner Coach");
      const org3 = await h.org(ownerCoach, "RB Gym Three");
      const g3 = await h.group(org3, ownerCoach, "team", "RB tiny");
      const kid3 = await h.user("RB Kid Three");
      await h.member(g3, kid3);

      await h.asSuper();
      await db.query(`update public.profiles set is_platform_admin = true where id = $1`, [admin]);
      const post = async (grp, author, body) => (await db.query(`insert into public.posts (group_id, author_id, post_type, channel, body) values ($1, $2, 'user_post', 'general', $3) returning id`, [grp, author, body])).rows[0].id;
      const postByBo = await post(g, b, "a post by Bo");
      const postByAnn = await post(g, a, "a post by Ann");
      const postByCoach = await post(g, c1, "a post by the coach");
      const comment = (await db.query(`insert into public.comments (post_id, group_id, author_id, body) values ($1, $2, $3, 'a comment by Bo') returning id`, [postByAnn, g, b])).rows[0].id;
      const reply = (await db.query(`insert into public.comments (post_id, group_id, author_id, body, parent_comment_id) values ($1, $2, $3, 'a reply', $4) returning id`, [postByAnn, g, a, comment])).rows[0].id;
      const noticesOf = async (who) => (await db.query(`select body, link_path from public.notifications where profile_id = $1 and type = 'content_reported' order by created_at`, [who])).rows;

      const kinds = (await db.query(`select pg_get_constraintdef(c.oid) as d from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass`)).rows[0].d;
      h.check("the notice list has content_reported and still has the kinds it had", kinds.includes("'content_reported'") && ["payment_received", "request_decision", "late_change", "space_invite"].every((k) => kinds.includes(`'${k}'`)), kinds);

      // ---- a member reports another member's post: both coaches are told, nobody else, and no notice names the reporter
      await h.as(a);
      const rep = (await db.query(`select public.report_content($1, null, 'Rude to another member') as id`, [postByBo])).rows[0].id;
      h.check("a member reports a post in their group", !!rep);
      h.check("reporting the same thing again returns the same open report", (await db.query(`select public.report_content($1, null, 'again') as id`, [postByBo])).rows[0].id === rep);
      h.check("the filer cannot read the reports at all (not even their own)", (await db.query(`select count(*)::int as n from public.content_reports`)).rows[0].n === 0);
      h.check("a report needs a reason", (await msg(db, `select public.report_content($1, null, '   ')`, [postByBo])).includes("why"));
      h.check("a report names a post or a comment, not both and not neither", (await msg(db, `select public.report_content($1, $2, 'x')`, [postByBo, comment])).length > 0 && (await msg(db, `select public.report_content(null, null, 'x')`)).length > 0);
      h.check("you cannot report your own post", (await msg(db, `select public.report_content($1, null, 'x')`, [postByAnn])).includes("your own"));
      h.check("a browser cannot write a report directly", (await msg(db, `insert into public.content_reports (group_id, reporter_id, content_kind, post_id, reason) values ($1, $2, 'post', $3, 'x')`, [g, a, postByBo])).length > 0);
      await h.asSuper();
      const n1 = await noticesOf(c1);
      const n2 = await noticesOf(c2);
      h.check("both coaches are told, with a link to the post and without the reporter's name", n1.length === 1 && n2.length === 1 && n1[0].link_path === `/groups/${g}/feed?highlight=${postByBo}` && !/RB Ann/.test(n1[0].body), JSON.stringify([n1, n2]));
      h.check("the person reported, the reporter and the organization owner are not told", (await noticesOf(b)).length === 0 && (await noticesOf(a)).length === 0 && (await noticesOf(owner)).length === 0);

      // ---- nobody can read who reported, not even a handler
      await h.as(c1);
      h.check("a coach reads the group's reports", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [rep])).rows[0].n === 1);
      h.check("but the reporter's id is in a column nobody can select", (await msg(db, `select reporter_id from public.content_reports`)).includes("permission denied"));
      h.check("and select * is refused too, so nothing can leak by accident", (await msg(db, `select * from public.content_reports`)).includes("permission denied"));
      await h.as(b);
      h.check("the person reported never sees the reports against them", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [rep])).rows[0].n === 0);
      await h.as(outsider);
      h.check("someone outside the group sees no reports and cannot report in it", (await db.query(`select count(*)::int as n from public.content_reports`)).rows[0].n === 0 && (await msg(db, `select public.report_content($1, null, 'x')`, [postByBo])).includes("not found"));

      // ---- a report about a COACH never goes to that coach
      await h.as(a);
      const repCoach = (await db.query(`select public.report_content($1, null, 'Said something wrong') as id`, [postByCoach])).rows[0].id;
      await h.asSuper();
      h.check("a report about a coach tells the OTHER coach and not the coach reported", (await noticesOf(c1)).length === 1 && (await noticesOf(c2)).length === 2, JSON.stringify([await noticesOf(c1), await noticesOf(c2)]));
      await h.as(c1);
      h.check("the coach reported cannot read the report against them", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [repCoach])).rows[0].n === 0);
      h.check("nor mark it handled, nor remove what was reported", (await msg(db, `select public.handle_content_report($1)`, [repCoach])).includes("not found") && (await msg(db, `select public.remove_reported_content($1)`, [repCoach])).includes("not found"));
      await h.as(c2);
      h.check("the other coach reads and handles it", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [repCoach])).rows[0].n === 1 && (await msg(db, `select public.handle_content_report($1)`, [repCoach])) === "");

      // ---- a group with ONE coach: a report about that coach goes to the organization's owner
      await h.asSuper();
      const soloPost = await post(g2, soloCoach, "the only coach's post");
      await h.as(kid);
      const repSolo = (await db.query(`select public.report_content($1, null, 'Not okay') as id`, [soloPost])).rows[0].id;
      await h.asSuper();
      const ownerNotices = await noticesOf(owner2);
      h.check("the organization's owner is told, and the coach reported is not", ownerNotices.length === 1 && ownerNotices[0].link_path === `/groups/${g2}/feed?highlight=${soloPost}` && (await noticesOf(soloCoach)).length === 0, JSON.stringify(ownerNotices));
      await h.as(soloCoach);
      h.check("the coach reported cannot read it", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [repSolo])).rows[0].n === 0);
      await h.as(owner2);
      h.check("the organization's owner reads it and can handle it", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [repSolo])).rows[0].n === 1 && (await msg(db, `select public.handle_content_report($1)`, [repSolo])) === "");

      // ---- the only coach IS the only owner: the platform administrators
      await h.asSuper();
      const tinyPost = await post(g3, ownerCoach, "the owner-coach's post");
      await h.as(kid3);
      const repTiny = (await db.query(`select public.report_content($1, null, 'Not okay either') as id`, [tinyPost])).rows[0].id;
      await h.asSuper();
      const adminNotices = await noticesOf(admin);
      h.check("a platform administrator is told (link to the reports page); the coach reported is not", adminNotices.length === 1 && adminNotices[0].link_path === "/reports" && (await noticesOf(ownerCoach)).length === 0, JSON.stringify(adminNotices));
      await h.as(ownerCoach);
      h.check("the coach-owner reported cannot read it", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [repTiny])).rows[0].n === 0);
      await h.as(admin);
      h.check("the platform administrator reads it and can remove the post", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [repTiny])).rows[0].n === 1 && (await msg(db, `select public.remove_reported_content($1)`, [repTiny])) === "");
      await h.asSuper();
      const kept = (await db.query(`select post_id, status, removed_at is not null as gone, content_excerpt, content_kind from public.content_reports where id = $1`, [repTiny])).rows[0];
      h.check("the post is gone but the record keeps what it said", (await db.query(`select count(*)::int as n from public.posts where id = $1`, [tinyPost])).rows[0].n === 0 && kept.post_id === null && kept.status === "handled" && kept.gone && kept.content_excerpt === "the owner-coach's post" && kept.content_kind === "post", JSON.stringify(kept));

      // ---- a one-on-one space that is PRIVATE from the organization never sends a report to the organization's owner or admins: straight to the platform administrators
      const privCoach = await h.user("RB Private Coach");
      const privClient = await h.user("RB Private Client");
      await h.orgMember(org2, privCoach, "coach");
      const gp = await h.group(org2, privCoach, "one_on_one", "RB private space");
      await h.member(gp, privClient);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [gp, privClient]);
      const privPost = await post(gp, privCoach, "the private coach's post");
      await h.as(privClient);
      const repPriv = (await db.query(`select public.report_content($1, null, 'Not okay in private') as id`, [privPost])).rows[0].id;
      await h.asSuper();
      h.check("the organization's owner is NOT told about a report in a private space", (await noticesOf(owner2)).length === 1, JSON.stringify(await noticesOf(owner2)));
      h.check("the platform administrator is", (await noticesOf(admin)).length === 2);
      await h.as(owner2);
      h.check("the organization's owner cannot read it, handle it or remove what was reported", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [repPriv])).rows[0].n === 0 && (await msg(db, `select public.handle_content_report($1)`, [repPriv])).includes("not found") && (await msg(db, `select public.remove_reported_content($1)`, [repPriv])).includes("not found"));
      await h.as(admin);
      h.check("the platform administrator reads it and can handle it", (await db.query(`select count(*)::int as n from public.content_reports where id = $1`, [repPriv])).rows[0].n === 1 && (await msg(db, `select public.handle_content_report($1)`, [repPriv])) === "");
      await h.asSuper();

      // ---- a stale click cannot delete what someone else decided to keep
      await h.as(a);
      const repStale = (await db.query(`select public.report_content($1, null, 'Check this one') as id`, [postByBo])).rows[0].id;
      await h.as(c1);
      await db.query(`select public.handle_content_report($1)`, [repStale]);
      await h.as(c2);
      h.check("removing a report someone else already handled is refused, and the post stays", (await msg(db, `select public.remove_reported_content($1)`, [repStale])).includes("already handled") && (await db.query(`select count(*)::int as n from public.posts where id = $1`, [postByBo])).rows[0].n === 1);
      await h.asSuper();

      // ---- removing a comment says how many replies went with it
      await h.as(b);
      h.check("a member cannot remove reported content", (await msg(db, `select public.remove_reported_content($1)`, [rep])).includes("not found"));
      await h.as(a);
      const repComment = (await db.query(`select public.report_content(null, $1, 'Mean comment') as id`, [comment])).rows[0].id;
      await h.as(c2);
      const replies = (await db.query(`select public.remove_reported_content($1) as n`, [repComment])).rows[0].n;
      await h.asSuper();
      h.check("removing a comment removes its replies and reports how many", replies === 1 && (await db.query(`select count(*)::int as n from public.comments where id = any($1::uuid[])`, [[comment, reply]])).rows[0].n === 0);

      // ---- a daily cap
      await h.asSuper();
      const many = [];
      for (let i = 0; i < 22; i++) many.push(await post(g, b, `post ${i}`));
      await h.as(outsider);
      await h.asSuper();
      await h.member(g, outsider);
      await h.as(outsider);
      let filed = 0;
      let refusal = "";
      for (const p of many) {
        const e = await msg(db, `select public.report_content($1, null, 'spam')`, [p]);
        if (e) {
          refusal = e;
          break;
        }
        filed++;
      }
      h.check("a person can file 20 reports in a day and no more, with a friendly message", filed === 20 && refusal.includes("a lot of reports"), `${filed} ${refusal}`);

      // ---- blocks
      await h.as(a);
      await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [a, b]);
      h.check("a member blocks another", (await db.query(`select count(*)::int as n from public.user_blocks`)).rows[0].n === 1);
      h.check("blocking yourself is refused", (await msg(db, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $1)`, [a])).length > 0);
      h.check("a block cannot be made for someone else", (await msg(db, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [b, c1])).length > 0);
      await h.as(b);
      h.check("the blocked person cannot see that they are blocked", (await db.query(`select count(*)::int as n from public.user_blocks`)).rows[0].n === 0);
      await h.as(c1);
      h.check("nor can a coach", (await db.query(`select count(*)::int as n from public.user_blocks`)).rows[0].n === 0);
      await h.as(a);
      await db.query(`delete from public.user_blocks where blocker_id = $1 and blocked_id = $2`, [a, b]);
      h.check("and a block can be taken off", (await db.query(`select count(*)::int as n from public.user_blocks`)).rows[0].n === 0);
      await h.asSuper();
    },
  },
};
