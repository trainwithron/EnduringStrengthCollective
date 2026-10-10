// 0327: a coach's own wording for the sign-in link email. Private to the coach (row security), one row per coach, the message must contain {link} (checked by the database too),
// length limits, and deleting a coach removes it. Nothing here touches a client or a program.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0327 a coach's sign-in email wording is private to the coach",
  migrations: ["0327"],
  phases: {
    async "0327"({ db, h }) {
      const coach = await h.user("MT Coach");
      const other = await h.user("MT Other Coach");

      await h.as(coach);
      const ok = await tryQ(db, "insert into public.coach_message_templates (coach_id, claim_email_subject, claim_email_body) values ($1, 'Hi from {coach_name}', 'Welcome {first_name}. Sign in: {link}') returning claim_email_body", [coach]);
      h.check("the coach can save their own wording", !!ok.rows?.[0]?.claim_email_body, JSON.stringify(ok));
      const again = await tryQ(db, "insert into public.coach_message_templates (coach_id, claim_email_subject, claim_email_body) values ($1, 'x', '{link}')", [coach]);
      h.check("there is only one saved wording per coach (it is replaced, not added to)", !!again.error, JSON.stringify(again));
      const noLink = await tryQ(db, "update public.coach_message_templates set claim_email_body = 'Welcome, sign in please' where coach_id = $1", [coach]);
      h.check("a message without {link} is refused by the database too", !!noLink.error, JSON.stringify(noLink));
      const emptySubject = await tryQ(db, "update public.coach_message_templates set claim_email_subject = '' where coach_id = $1", [coach]);
      h.check("an empty subject is refused", !!emptySubject.error, JSON.stringify(emptySubject));
      const longBody = await tryQ(db, "update public.coach_message_templates set claim_email_body = '{link}' || repeat('x', 2001) where coach_id = $1", [coach]);
      h.check("a message over the length limit is refused", !!longBody.error, JSON.stringify(longBody));
      const updated = await tryQ(db, "update public.coach_message_templates set claim_email_body = 'New wording {link}' where coach_id = $1 returning claim_email_body", [coach]);
      h.check("the coach can change their wording", updated.rows?.[0]?.claim_email_body === "New wording {link}", JSON.stringify(updated));

      await h.as(other);
      const seen = (await h.one("select count(*)::int as n from public.coach_message_templates")).n;
      h.check("another coach cannot read it", seen === 0, String(seen));
      const forged = await tryQ(db, "insert into public.coach_message_templates (coach_id, claim_email_subject, claim_email_body) values ($1, 'x', '{link}')", [coach]);
      h.check("another coach cannot write under this coach's name", !!forged.error, JSON.stringify(forged));
      const changed = await tryQ(db, "update public.coach_message_templates set claim_email_body = 'hijack {link}' where coach_id = $1 returning coach_id", [coach]);
      h.check("another coach cannot change it", (changed.rows ?? []).length === 0, JSON.stringify(changed));
      const removed = await tryQ(db, "delete from public.coach_message_templates where coach_id = $1 returning coach_id", [coach]);
      h.check("another coach cannot delete it", (removed.rows ?? []).length === 0, JSON.stringify(removed));

      await h.as(coach);
      const back = await tryQ(db, "delete from public.coach_message_templates where coach_id = $1 returning coach_id", [coach]);
      h.check("the coach can go back to the default (the row is deleted)", (back.rows ?? []).length === 1, JSON.stringify(back));

      await h.as(coach);
      await db.query("insert into public.coach_message_templates (coach_id, claim_email_subject, claim_email_body) values ($1, 's', '{link}')", [coach]);
      await h.asSuper();
      await db.query("delete from public.profiles where id = $1", [coach]).catch(() => null);
      const left = await h.one("select count(*)::int as n from public.coach_message_templates where coach_id = $1", [coach]);
      h.check("deleting a coach removes their saved wording", left.n === 0, JSON.stringify(left));
    },
  },
};
