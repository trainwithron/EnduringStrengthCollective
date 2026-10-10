// 0326: the optional coach conversation. Private to the coach (row security), one conversation per coach and chapter, limited states, the invitation state is limited, and deleting a
// coach removes what they said. Nothing here touches a program, a client or a safety rule.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0326 the coach conversation is private to the coach",
  migrations: ["0326"],
  phases: {
    async "0326"({ db, h }) {
      const coach = await h.user("CV Coach");
      const other = await h.user("CV Other Coach");

      await h.as(coach);
      const set = await tryQ(db, "insert into public.coach_learning_settings (coach_id) values ($1) returning invite_state, invite_reminders", [coach]);
      h.check("the invitation starts as new with no reminders", set.rows?.[0]?.invite_state === "new" && set.rows[0].invite_reminders === 0, JSON.stringify(set));
      const bad = await tryQ(db, "update public.coach_learning_settings set invite_state = 'nagging' where coach_id = $1", [coach]);
      h.check("only the known invitation states are allowed", !!bad.error, JSON.stringify(bad));
      const ok = await tryQ(db, "update public.coach_learning_settings set invite_state = 'later', invite_shown_at = now() where coach_id = $1 returning invite_state", [coach]);
      h.check("Not now can be recorded", ok.rows?.[0]?.invite_state === "later", JSON.stringify(ok));

      const conv = await tryQ(db, "insert into public.coach_conversations (coach_id, chapter) values ($1, 'programming') returning id, status, coach_turns", [coach]);
      h.check("the coach starts the programming chapter", conv.rows?.[0]?.status === "active" && conv.rows[0].coach_turns === 0, JSON.stringify(conv));
      const again = await tryQ(db, "insert into public.coach_conversations (coach_id, chapter) values ($1, 'programming')", [coach]);
      h.check("there is only one conversation per chapter (it is resumed, not restarted)", !!again.error, JSON.stringify(again));
      const badChapter = await tryQ(db, "insert into public.coach_conversations (coach_id, chapter) values ($1, 'nutrition')", [coach]);
      h.check("only chapters that exist can be started", !!badChapter.error, JSON.stringify(badChapter));
      const badStatus = await tryQ(db, "update public.coach_conversations set status = 'paused' where id = $1", [conv.rows[0].id]);
      h.check("only the known conversation states are allowed", !!badStatus.error, JSON.stringify(badStatus));
      const msg = await tryQ(db, "insert into public.coach_conversation_messages (conversation_id, coach_id, role, body) values ($1, $2, 'assistant', 'Why do you start with a hinge?') returning id", [conv.rows[0].id, coach]);
      h.check("what is said is kept", !!msg.rows?.[0]?.id, JSON.stringify(msg));
      const empty = await tryQ(db, "insert into public.coach_conversation_messages (conversation_id, coach_id, role, body) values ($1, $2, 'coach', '')", [conv.rows[0].id, coach]);
      h.check("an empty message is refused", !!empty.error, JSON.stringify(empty));

      await h.as(other);
      for (const t of ["coach_conversations", "coach_conversation_messages"]) {
        const n = (await h.one(`select count(*)::int as n from public.${t}`)).n;
        h.check(`another coach cannot read the ${t} rows`, n === 0, String(n));
      }
      const forged = await tryQ(db, "insert into public.coach_conversation_messages (conversation_id, coach_id, role, body) values ($1, $2, 'coach', 'hi')", [conv.rows[0].id, coach]);
      h.check("another coach cannot write into this coach's conversation", !!forged.error, JSON.stringify(forged));
      const hijack = await tryQ(db, "insert into public.coach_conversation_messages (conversation_id, coach_id, role, body) values ($1, $2, 'coach', 'hi') returning id", [conv.rows[0].id, other]);
      h.check("...even under their own name", !!hijack.error, JSON.stringify(hijack));

      await h.asSuper();
      await db.query("delete from public.profiles where id = $1", [coach]).catch(() => null);
      const left = await h.one("select count(*)::int as n from public.coach_conversation_messages where coach_id = $1", [coach]);
      h.check("deleting a coach removes what they said", left.n === 0, JSON.stringify(left));
    },
  },
};
