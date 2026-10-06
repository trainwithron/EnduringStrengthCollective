// 0276: a new direct message writes one in-app notification for the recipient, without the text, and a burst is one line. Before 0276 nothing is
// written (the gap exists on the live schema today).
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0276 new message notice",
  migrations: ["0276"],
  phases: {
    async "0275"({ db, h, state }) {
      const coach = await h.user("N Coach");
      const ann = await h.user("N Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "N group");
      await h.member(group, ann);
      Object.assign(state, { coach, ann, group });
      await h.as(ann);
      const sent = await tryQ(db, `insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'secret words') returning id`, [group, ann, coach]);
      await h.asSuper();
      const n = (await h.one(`select count(*)::int as n from public.notifications where profile_id = $1`, [coach])).n;
      h.check("baseline: on the live schema a message creates no notification for the recipient (the gap 0276 closes)", !!sent.rows && n === 0, JSON.stringify({ sent, n }));
      await db.query(`delete from public.direct_messages where group_id = $1`, [group]);
    },

    async "0276"({ db, h, state }) {
      const { coach, ann, group } = state;
      await h.as(ann);
      for (const body of ["one secret", "two secret", "three secret"]) {
        await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, $4)`, [group, ann, coach, body]);
      }
      await h.asSuper();
      let rows = await h.rows(`select type, body, link_path, read_at from public.notifications where profile_id = $1`, [coach]);
      h.check("after 0276 three messages in a row make one notice for the coach", rows.length === 1 && rows[0].type === "direct_message", JSON.stringify(rows));
      h.check("it names who wrote and does not contain the message text", /N Ann sent you a message/.test(rows[0].body) && !/secret/.test(rows[0].body), rows[0].body);
      h.check("it links to that conversation", rows[0].link_path === `/groups/${group}/messages/${ann}`, rows[0].link_path);

      // the coach can read it (row security), the client cannot
      await h.as(coach);
      const mine = await tryQ(db, `select count(*)::int as n from public.notifications`);
      await h.as(ann);
      const theirs = await tryQ(db, `select count(*)::int as n from public.notifications where profile_id = $1`, [coach]);
      h.check("the recipient sees the notice and the sender cannot see someone else's", mine.rows?.[0]?.n === 1 && theirs.rows?.[0]?.n === 0, JSON.stringify({ mine, theirs }));

      // once read, the next message makes a new notice
      await h.as(coach);
      await db.query(`update public.notifications set read_at = now() where profile_id = $1`, [coach]);
      await h.as(ann);
      await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'again')`, [group, ann, coach]);
      await h.asSuper();
      rows = await h.rows(`select read_at from public.notifications where profile_id = $1 order by created_at`, [coach]);
      h.check("after the coach has read it, the next message makes a fresh notice", rows.length === 2 && rows[0].read_at && !rows[1].read_at, JSON.stringify(rows));

      // the reply reaches the client
      await h.as(coach);
      await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'reply')`, [group, coach, ann]);
      await h.asSuper();
      const annNotes = await h.rows(`select body, link_path from public.notifications where profile_id = $1`, [ann]);
      h.check("the coach's reply gives the client a notice that links to the coach's conversation", annNotes.length === 1 && annNotes[0].link_path === `/groups/${group}/messages/${coach}`, JSON.stringify(annNotes));
    },
  },
};
