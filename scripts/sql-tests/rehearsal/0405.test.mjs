// 0405: the bell notices name a member under 18 (or of unknown age) as a first name and last initial; coaches and adults in full.
const noticeFor = async (db, recipient) => (await db.query(`select body from public.notifications where profile_id = $1 order by created_at desc limit 1`, [recipient])).rows[0]?.body ?? null;

export default {
  name: "0405 Notice names",
  migrations: ["0405"],
  phases: {
    async "0405"({ db, h }) {
      const coach = await h.user("NN Coach Dana");
      const owner = await h.user("NN Owner Olive");
      const kid = await h.user("Sam Rivera");
      const unknown = await h.user("Unknown Ugo");
      const grown = await h.user("Gina Grown");
      const target = await h.user("Tess Target");
      const org = await h.org(owner, "NN Gym");
      const g = await h.group(org, coach, "team", "NN Team");
      for (const p of [kid, unknown, grown, target]) await h.member(g, p);
      await h.asSuper();
      await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, (current_date - interval '15 years')::date), ($3, $2, (current_date - interval '30 years')::date)`, [kid, g, grown]);

      const postBy = async (author, mentions = []) => (await db.query(`insert into public.posts (group_id, author_id, post_type, channel, body, mentioned_profile_ids) values ($1, $2, 'user_post', 'general', 'hello', $3::uuid[]) returning id`, [g, author, mentions])).rows[0].id;
      const commentBy = async (post, author, mentions = []) => db.query(`insert into public.comments (post_id, group_id, author_id, body, mentioned_profile_ids) values ($1, $4, $2, 'hi', $3::uuid[])`, [post, author, mentions, g]);

      const post = await postBy(target);
      await commentBy(post, kid);
      h.check("a comment by a client under 18 reads 'Sam R.'", (await noticeFor(db, target)) === "Sam R. commented on your post", String(await noticeFor(db, target)));
      await commentBy(post, unknown);
      h.check("so does one by a client with no date of birth on file", (await noticeFor(db, target)) === "Unknown U. commented on your post", String(await noticeFor(db, target)));
      await commentBy(post, grown);
      h.check("an adult client is named in full", (await noticeFor(db, target)) === "Gina Grown commented on your post", String(await noticeFor(db, target)));
      await commentBy(post, coach);
      h.check("a coach is named in full (they have no date of birth on file)", (await noticeFor(db, target)) === "NN Coach Dana commented on your post", String(await noticeFor(db, target)));
      await commentBy(post, owner);
      h.check("an owner who is not also a client is named in full", (await noticeFor(db, target)) === "NN Owner Olive commented on your post", String(await noticeFor(db, target)));

      await postBy(kid, [target]);
      h.check("a post that mentions someone names the author as 'Sam R.'", (await noticeFor(db, target)) === "Sam R. mentioned you in a post", String(await noticeFor(db, target)));
      await commentBy(post, kid, [target]);
      const mentions = (await db.query(`select body from public.notifications where profile_id = $1 and body like '%mentioned you in a comment'`, [target])).rows;
      h.check("a comment that mentions someone names the author as 'Sam R.'", mentions.length === 1 && mentions[0].body === "Sam R. mentioned you in a comment", JSON.stringify(mentions));
      const reply = (await db.query(`insert into public.comments (post_id, group_id, author_id, body) values ($1, $3, $2, 'first') returning id`, [post, grown, g])).rows[0].id;
      await db.query(`insert into public.comments (post_id, group_id, author_id, body, parent_comment_id) values ($1, $4, $2, 'reply', $3)`, [post, kid, reply, g]);
      const replied = (await db.query(`select body from public.notifications where profile_id = $1 and body like '%replied to your comment'`, [grown])).rows;
      h.check("a reply to someone's comment names the author as 'Sam R.'", replied.length === 1 && replied[0].body === "Sam R. replied to your comment", JSON.stringify(replied));
      h.check("the helper is not callable by a signed-in person", (await (async () => { await h.as(kid); try { await db.query(`select public.notice_display_name($1)`, [coach]); return false; } catch { return true; } finally { await h.asSuper(); } })()));
    },
  },
};
