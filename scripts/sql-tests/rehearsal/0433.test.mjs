// 0433 Audit hardening: undoing "attended" takes the same check as a no-show (the booking's own coach, or an organization owner/admin); signed-out visitors have no rights on two tables.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0433 undo attended: the booking's coach or an admin; anon revokes",
  migrations: ["0433"],
  phases: {
    async "0433"({ db, h }) {
      const owner = await h.user("UA Owner");
      const coach = await h.user("UA Coach");
      const other = await h.user("UA Other Coach");
      const admin = await h.user("UA Admin");
      const ann = await h.user("UA Ann");
      const org = await h.org(owner);
      await h.orgMember(org, coach, "coach");
      await h.orgMember(org, other, "coach");
      await h.orgMember(org, admin, "admin");
      const group = await h.group(org, coach, "team", "UA group");
      await h.member(group, other, "coach");
      await h.member(group, ann);
      await h.asSuper();
      await db.query("insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 10) on conflict do nothing", [ann, group]);
      const mk = async (daysAgo) =>
        (await h.one(
          "insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1, $2, $3, now() - make_interval(days => $4), now() - make_interval(days => $4) + interval '1 hour', 'confirmed', 'unsettled') returning id",
          [coach, ann, group, daysAgo]
        )).id;
      const as = async (who, sql, params) => {
        await h.as(who);
        const r = await tryQ(db, sql, params);
        await h.asSuper();
        return r;
      };
      const mark = (who, id) => as(who, "select public.mark_booking_attended($1) as v", [id]);
      const undo = (who, id) => as(who, "select public.undo_booking_attended($1) as v", [id]);
      const attended = async (id) => (await h.one("select attended_at is not null as a from public.bookings where id = $1", [id])).a;

      const b1 = await mk(2);
      await mark(coach, b1);
      const byOther = await undo(other, b1);
      h.check("another coach of the group cannot undo the booking coach's attended session", /not authorized/.test(byOther.error ?? "") && (await attended(b1)) === true, JSON.stringify(byOther));
      const byCoach = await undo(coach, b1);
      h.check("the booking's own coach can", !byCoach.error && (await attended(b1)) === false, JSON.stringify(byCoach));

      const b2 = await mk(3);
      await mark(coach, b2);
      const byAdmin = await undo(admin, b2);
      h.check("an organization admin can", !byAdmin.error && (await attended(b2)) === false, JSON.stringify(byAdmin));
      const b3 = await mk(4);
      await mark(coach, b3);
      const byOwner = await undo(owner, b3);
      h.check("the organization owner can", !byOwner.error && (await attended(b3)) === false, JSON.stringify(byOwner));
      const byClient = await undo(ann, b3);
      h.check("the client cannot", /not authorized/.test(byClient.error ?? ""), JSON.stringify(byClient));

      const rights = await h.one(
        "select has_table_privilege('anon', 'public.client_macro_target_history', 'select') as a1, has_table_privilege('anon', 'public.coach_booking_policies', 'select') as a2, has_table_privilege('authenticated', 'public.coach_booking_policies', 'select') as s"
      );
      h.check("signed-out visitors have no rights on the two tables; signed-in people keep theirs", rights.a1 === false && rights.a2 === false && rights.s === true, JSON.stringify(rights));
    },
  },
};
