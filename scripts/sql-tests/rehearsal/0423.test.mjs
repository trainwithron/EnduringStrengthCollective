// 0423: a coach's own switches for the kinds of notice. A notice of a kind the recipient switched off is never written (so no row, so no push from the 5-minute job); every other notice is untouched; the switch is the
// person's own and nobody else's; the types that are not switchable (an invitation, an account closing...) always arrive.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0423 Coach notice switches",
  migrations: ["0423"],
  phases: {
    async "0423"({ db, h }) {
      const coach = await h.user("NS Coach");
      const other = await h.user("NS Other");
      await h.asSuper();

      const col = await tryQ(db, `select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'notices_off'`);
      h.check("the column exists, empty by default, never null", col.rows?.[0]?.is_nullable === "NO" && /'\{\}'/.test(col.rows[0].column_default ?? ""), JSON.stringify(col));

      const kinds = await tryQ(db, `select public.notice_kind_of('direct_message') a, public.notice_kind_of('booking_request') b, public.notice_kind_of('milestone_celebration') c, public.notice_kind_of('payment_received') d, public.notice_kind_of('organization_invite') e, public.notice_kind_of('coach_account_closed') f, public.notice_kind_of('anything') g`);
      const k = kinds.rows?.[0] ?? {};
      h.check("each type maps to its kind; invitations, account closing and unknown types map to nothing", k.a === "messages" && k.b === "bookings" && k.c === "milestones" && k.d === "payments" && k.e === null && k.f === null && k.g === null, JSON.stringify(k));

      const put = (profile, type) => db.query(`insert into public.notifications (profile_id, type, body, link_path) values ($1, $2, 'x', '/') returning id`, [profile, type]);
      const count = async (profile, type) => (await db.query(`select count(*)::int n from public.notifications where profile_id = $1 and type = $2`, [profile, type])).rows[0].n;

      await put(coach, "direct_message");
      h.check("with everything on, a message notice is written", (await count(coach, "direct_message")) === 1);

      await db.query(`update public.profiles set notices_off = array['messages', 'payments'] where id = $1`, [coach]);
      await put(coach, "direct_message");
      await put(coach, "comment");
      await put(coach, "payment_received");
      h.check("switch messages off: message and comment notices are not written (still 1 from before), payments neither", (await count(coach, "direct_message")) === 1 && (await count(coach, "comment")) === 0 && (await count(coach, "payment_received")) === 0);
      await put(coach, "booking_request");
      await put(coach, "milestone_celebration");
      h.check("other kinds still arrive", (await count(coach, "booking_request")) === 1 && (await count(coach, "milestone_celebration")) === 1);
      await put(coach, "organization_invite");
      await put(coach, "coach_account_closed");
      h.check("a notice that cannot be switched off always arrives", (await count(coach, "organization_invite")) === 1 && (await count(coach, "coach_account_closed")) === 1);

      await put(other, "direct_message");
      h.check("someone else's switch is theirs alone: their own messages still arrive", (await count(other, "direct_message")) === 1);

      // the person changes only their own switches
      await h.as(coach);
      let r = await tryQ(db, `update public.profiles set notices_off = array['milestones'] where id = $1 returning notices_off`, [coach]);
      h.check("a person can change their own switches" + (r.error ? ": " + r.error : ""), !r.error && r.rows.length === 1 && r.rows[0].notices_off[0] === "milestones", JSON.stringify(r));
      r = await tryQ(db, `update public.profiles set notices_off = array['messages'] where id = $1 returning id`, [other]);
      h.check("but not anyone else's", !!r.error || r.rows.length === 0, JSON.stringify(r));
      await h.asSuper();

      await db.query(`update public.profiles set notices_off = '{}' where id = $1`, [coach]);
      await put(coach, "comment");
      h.check("switched back on, they arrive again", (await count(coach, "comment")) === 1);

      const acl = await tryQ(db, `select has_function_privilege('authenticated', 'public.notifications_respect_switch()', 'execute') as can`);
      h.check("the trigger function cannot be called by signed-in people", acl.rows?.[0]?.can === false, JSON.stringify(acl));
    },
  },
};
