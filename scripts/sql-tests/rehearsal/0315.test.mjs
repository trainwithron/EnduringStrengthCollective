// 0315: the "I'm away" preset reply. While it is on, a client's message to their coach gets the coach's own reply back in the same thread (marked auto_reply); never a loop, never to
// a coach's own message, not after the last day, no limit on how many, and nobody can fake the mark or read/change another coach's setting.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0315 away reply (preset reply to a client's message)",
  migrations: ["0315"],
  phases: {
    async "0315"({ db, h }) {
      const coach = await h.user("Away Coach");
      const other = await h.user("Away Other Coach");
      const ann = await h.user("Away Ann");
      const bo = await h.user("Away Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Away group");
      await h.member(group, ann);
      await h.member(group, bo);
      const org2 = await h.org(other);
      const group2 = await h.group(org2, other, "team", "Other group");
      await h.member(group2, bo);

      const msgs = (a, b) => h.rows("select sender_id, recipient_id, body, auto_reply from public.direct_messages where group_id = $1 and ((sender_id = $2 and recipient_id = $3) or (sender_id = $3 and recipient_id = $2)) order by created_at, id", [group, a, b]);
      const say = async (who, to, body) => {
        await h.as(who);
        return tryQ(db, "insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, $4)", [group, who, to, body]);
      };

      const reset = async () => {
        await h.asSuper();
        await db.query("delete from public.direct_messages");
        await db.query("delete from public.notifications");
      };

      // off by default: no setting, no reply
      await h.asSuper();
      const s0 = await say(ann, coach, "hi coach");
      await h.asSuper();
      h.check("with no setting, a client's message gets no reply", !s0.error && (await msgs(ann, coach)).length === 1);

      // the coach turns it on
      await h.as(coach);
      const on = await tryQ(db, "insert into public.coach_away_replies (coach_id, enabled, message) values ($1, true, 'I am away, back soon.') on conflict (coach_id) do update set enabled = true, message = excluded.message", [coach]);
      h.check("a coach can save their own away reply", !on.error, JSON.stringify(on));

      // a client message now gets the reply
      await reset();
      const s1 = await say(ann, coach, "can we move Thursday?");
      await h.asSuper();
      const t1 = await msgs(ann, coach);
      h.check("the client's message gets the coach's reply, from the coach, marked as an auto-reply", !s1.error && t1.length === 2 && t1[1].sender_id === coach && t1[1].recipient_id === ann && t1[1].body === "I am away, back soon." && t1[1].auto_reply === true && t1[0].auto_reply === false, JSON.stringify({ s1, t1 }));
      const noLoop = await h.rows("select 1 from public.direct_messages where auto_reply");
      h.check("exactly one auto-reply (no loop)", noLoop.length === 1);

      // the coach still gets the normal notice for the client's message; the client gets one for the reply
      const bellCoach = await h.rows("select 1 from public.notifications where profile_id = $1 and type = 'direct_message'", [coach]);
      const bellAnn = await h.rows("select 1 from public.notifications where profile_id = $1 and type = 'direct_message'", [ann]);
      h.check("the coach still gets the notice for the client's message, and the client for the reply", bellCoach.length === 1 && bellAnn.length === 1, JSON.stringify({ bellCoach, bellAnn }));

      // no limit: three quick messages get three more replies (four in all), and still no loop
      await say(ann, coach, "and also Friday?");
      await say(ann, coach, "hello?");
      await say(ann, coach, "any news?");
      await h.asSuper();
      const manyReplies = await h.rows("select sender_id, auto_reply from public.direct_messages where auto_reply");
      h.check("every message gets its own reply, however quick (four messages, four replies, none from the client)", manyReplies.length === 4 && manyReplies.every((r) => r.sender_id === coach), JSON.stringify(manyReplies));
      h.check("and no loop: eight rows in the thread, four of them replies", (await msgs(ann, coach)).length === 8);

      // each client is answered separately
      await say(bo, coach, "hey from Bo");
      await h.asSuper();
      h.check("another client gets their own reply", (await msgs(bo, coach)).length === 2);

      // the coach's own message gets no reply, and does not trigger one
      await reset();
      await h.as(coach);
      const c1 = await tryQ(db, "insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'checking in')", [group, coach, ann]);
      await h.asSuper();
      h.check("a coach's own message to a client gets no auto-reply", !c1.error && (await h.rows("select 1 from public.direct_messages")).length === 1);

      // a person cannot mark their own message as an auto-reply, nor change the mark
      await reset();
      await h.as(coach);
      await tryQ(db, "update public.coach_away_replies set enabled = false where coach_id = $1", [coach]);
      await h.as(ann);
      const forged = await tryQ(db, "insert into public.direct_messages (group_id, sender_id, recipient_id, body, auto_reply) values ($1, $2, $3, 'forged', true)", [group, ann, coach]);
      await h.asSuper();
      const forgedRow = await h.one("select auto_reply from public.direct_messages where body = 'forged'");
      h.check("a signed-in person cannot create a message marked as an auto-reply", !forged.error && forgedRow && forgedRow.auto_reply === false, JSON.stringify({ forged, forgedRow }));
      await h.as(coach);
      await tryQ(db, "update public.direct_messages set auto_reply = true where body = 'forged'");
      await h.asSuper();
      h.check("nor change the mark afterwards", (await h.one("select auto_reply from public.direct_messages where body = 'forged'")).auto_reply === false);

      // off means off
      h.check("with it off, no reply was sent", (await h.rows("select 1 from public.direct_messages where auto_reply")).length === 0);

      // ends_on in the past: no reply; today or later: reply
      await h.as(coach);
      await tryQ(db, "update public.coach_away_replies set enabled = true, ends_on = current_date - 3 where coach_id = $1", [coach]);
      await say(ann, coach, "after the last day");
      await h.asSuper();
      h.check("after the last day it no longer replies", (await h.rows("select 1 from public.direct_messages where auto_reply")).length === 0);
      await h.as(coach);
      await tryQ(db, "update public.coach_away_replies set ends_on = current_date + 1 where coach_id = $1", [coach]);
      await say(ann, coach, "before the last day");
      await h.asSuper();
      h.check("up to the last day it replies", (await h.rows("select 1 from public.direct_messages where auto_reply")).length === 1);

      // an empty reply text sends nothing
      await reset();
      await h.as(coach);
      await tryQ(db, "update public.coach_away_replies set message = '   ', ends_on = null where coach_id = $1", [coach]);
      await say(bo, coach, "empty text case");
      await h.asSuper();
      h.check("an empty reply text sends nothing", (await h.rows("select 1 from public.direct_messages where auto_reply")).length === 0);

      // another coach's setting is private and does not apply to this coach's group
      await h.as(other);
      await tryQ(db, "insert into public.coach_away_replies (coach_id, enabled, message) values ($1, true, 'Other coach away') on conflict (coach_id) do nothing", [other]);
      const seeOther = await h.rows("select coach_id from public.coach_away_replies");
      h.check("a coach sees only their own setting", seeOther.length === 1 && seeOther[0].coach_id === other, JSON.stringify(seeOther));
      await h.as(ann);
      const seeAnn = await h.rows("select 1 from public.coach_away_replies");
      const writeAnn = await tryQ(db, "insert into public.coach_away_replies (coach_id, enabled, message) values ($1, true, 'x')", [coach]);
      h.check("a client cannot read or write any away setting", seeAnn.length === 0 && !!writeAnn.error, JSON.stringify({ seeAnn, writeAnn }));
      await h.as(other);
      const stealWrite = await db.query("update public.coach_away_replies set message = 'hijack' where coach_id = $1", [coach]);
      h.check("a coach cannot change another coach's setting", (stealWrite.rowCount ?? 0) === 0);
      await h.asSuper();
      await h.asSuper();
      await db.query("update public.coach_away_replies set enabled = true, message = 'Coach one away' where coach_id = $1", [coach]);
      await h.as(bo);
      await db.query("insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'to the other coach')", [group2, bo, other]);
      await h.asSuper();
      const otherThread = await h.rows("select sender_id, body from public.direct_messages where group_id = $1 and auto_reply", [group2]);
      h.check("a client of coach two is answered with coach two's text, never coach one's", otherThread.length === 1 && otherThread[0].sender_id === other && otherThread[0].body === "Other coach away", JSON.stringify(otherThread));

      // if writing the reply fails for any reason, the client's own message is still stored
      await reset();
      await h.asSuper();
      await db.query("update public.coach_away_replies set enabled = true, message = 'Coach one away', ends_on = null where coach_id = $1", [coach]);
      await db.query("alter table public.direct_messages add constraint tmp_block_auto_reply check (not auto_reply)");
      const blocked = await say(ann, coach, "message while the reply cannot be written");
      await h.asSuper();
      const keptRows = await msgs(ann, coach);
      await db.query("alter table public.direct_messages drop constraint tmp_block_auto_reply");
      h.check("when the reply cannot be written, the client's message is still stored (and no reply)", !blocked.error && keptRows.length === 1 && keptRows[0].auto_reply === false, JSON.stringify({ blocked, keptRows }));
      const afterFail = await say(ann, coach, "next one after the failure");
      await h.asSuper();
      const flagged = await h.rows("select auto_reply from public.direct_messages where body = 'next one after the failure'");
      h.check("a failure leaves nothing behind: the next message works normally and is not marked", !afterFail.error && flagged.length === 1 && flagged[0].auto_reply === false);

      // grants
      const g = await h.one(
        "select has_function_privilege('authenticated', 'public.send_away_reply()', 'execute') as a, has_function_privilege('anon', 'public.send_away_reply()', 'execute') as b, has_table_privilege('anon', 'public.coach_away_replies', 'select') as c, has_table_privilege('authenticated', 'public.coach_away_replies', 'truncate') as d"
      );
      h.check("the functions are closed to signed-in users and the table to signed-out visitors", !g.a && !g.b && !g.c && !g.d, JSON.stringify(g));
    },
  },
};
