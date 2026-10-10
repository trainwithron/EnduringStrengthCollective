// 0323: group events. A coach adds an event for one group; members answer In or Out; it costs no session credit on ANY path (join, leave, waiting list, cancel, mark there), and the class
// functions refuse an event so there is no way from an event to the ledger. Out is written down even for someone who never said In (so Out is not the same as no answer). Classes behave as before.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};
const inDays = (d, hours = 0) => new Date(Date.now() + d * 86400000 + hours * 3600000).toISOString();

export default {
  name: "0323 group events cost no credit",
  migrations: ["0323"],
  phases: {
    async "0323"({ db, h }) {
      const coach = await h.user("GE Coach");
      const ann = await h.user("GE Ann");
      const bo = await h.user("GE Bo");
      const cy = await h.user("GE Cy");
      const outsider = await h.user("GE Outsider");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "GE group");
      const otherGroup = await h.group(org, coach, "team", "GE other group");
      for (const p of [ann, bo, cy]) await h.member(group, p);
      await h.member(otherGroup, outsider);
      const coach2 = await h.user("GE Coach Two");
      await h.member(group, coach2, "coach");
      const orgAdmin = await h.user("GE Org Admin");
      await h.asSuper();
      await db.query("insert into public.organization_memberships (organization_id, profile_id, role) values ($1, $2, 'admin')", [org, orgAdmin]);

      await h.asSuper();
      for (const p of [ann, bo, cy]) await db.query("insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 3) on conflict (athlete_id, group_id) do update set balance = 3", [p, group]);
      const bal = async (p) => (await h.asSuper(), (await h.one("select balance from public.session_credits where athlete_id = $1 and group_id = $2", [p, group])).balance);
      const ledger = async () => (await h.asSuper(), (await h.one("select count(*)::int as n from public.session_credit_ledger where group_id = $1", [group])).n);
      const statusOf = async (ev, p) => (await h.asSuper(), (await h.rows("select status from public.group_session_attendees where group_session_id = $1 and athlete_id = $2", [ev, p]))[0]?.status ?? null);
      const startIso = inDays(20);
      const endIso = inDays(20, 2);
      const ledger0 = await ledger();

      // Create.
      await h.as(ann);
      h.check("a member cannot create an event", !!(await tryQ(db, "select public.create_group_event($1, 'Nope', $2, $3)", [group, startIso, endIso])).error);
      await h.as(coach);
      const ev = (await h.one("select public.create_group_event($1, 'Gym then lunch', $2, $3, 'The gym', 'Bring water') as id", [group, startIso, endIso])).id;
      h.check("the coach creates an event for the group", !!ev);
      await h.asSuper();
      const row = await h.one("select kind, group_id, capacity, location_note, note, anchor_booking_id from public.group_sessions where id = $1", [ev]);
      h.check("it is an event of that group with no limit on spots, a place, a note and a held time", row.kind === "event" && row.group_id === group && row.capacity === null && row.location_note === "The gym" && row.note === "Bring water" && !!row.anchor_booking_id, JSON.stringify(row));
      await h.as(coach);
      h.check("the event's time is held on the coach's calendar (a 1-on-1 booking then is refused)", !!(await tryQ(db, "select public.book_session($1, $2, $3, $4, $5)", [coach, ann, group, startIso, endIso])).error);

      // Members can read it; someone outside the group cannot.
      await h.as(ann);
      h.check("a member of the group can read the event", (await h.rows("select id from public.group_sessions where id = $1", [ev])).length === 1);
      await h.as(outsider);
      h.check("someone outside the group cannot read it", (await h.rows("select id from public.group_sessions where id = $1", [ev])).length === 0);

      // Who may see the answers.
      await h.as(ann);
      await h.one("select public.join_group_event($1, $2) as r", [ev, ann]);
      await h.as(bo);
      await h.one("select public.join_group_event($1, $2) as r", [ev, bo]);
      const seen = async (who) => (await h.as(who), (await h.rows("select athlete_id from public.group_session_attendees where group_session_id = $1", [ev])).map((r) => r.athlete_id).sort());
      h.check("the coach who made it sees everyone's answer", (await seen(coach)).length === 2);
      h.check("a second coach of the same group sees everyone's answer", (await seen(coach2)).length === 2);
      h.check("the organization's admin (not a member of the group) sees everyone's answer and the event", (await seen(orgAdmin)).length === 2 && (await (async () => (await h.as(orgAdmin), (await h.rows("select id from public.group_sessions where id = $1", [ev])).length))()) === 1);
      await h.asSuper();
      await db.query("update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2", [group, bo]);
      h.check("an organization admin does NOT see the answer of a member made private from the organization", JSON.stringify(await seen(orgAdmin)) === JSON.stringify([ann]));
      h.check("...while the group's own coaches still see it", (await seen(coach2)).length === 2 && (await seen(coach)).length === 2);
      await h.asSuper();
      await db.query("update public.group_memberships set private_from_org = false where group_id = $1 and profile_id = $2", [group, bo]);
      h.check("a plain member sees only their own answer", JSON.stringify(await seen(ann)) === JSON.stringify([ann]) && JSON.stringify(await seen(bo)) === JSON.stringify([bo]));
      h.check("a member of another group sees no answers", (await seen(outsider)).length === 0);
      await h.as(bo);
      await h.one("select public.leave_group_event($1, $2) as r", [ev, bo]);
      await h.as(ann);
      await h.one("select public.leave_group_event($1, $2) as r", [ev, ann]);
      await h.asSuper();
      await db.query("delete from public.group_session_attendees where group_session_id = $1", [ev]);

      // In, twice, costs nothing.
      await h.as(ann);
      h.check("In: a member says In", (await h.one("select public.join_group_event($1, $2) as r", [ev, ann])).r === "joined");
      h.check("asking In again is harmless", (await h.one("select public.join_group_event($1, $2) as r", [ev, ann])).r === "joined");
      h.check("In took no session and wrote no ledger row", (await bal(ann)) === 3 && (await ledger()) === ledger0);
      await h.as(outsider);
      h.check("someone who is not a member of the group cannot say In", !!(await tryQ(db, "select public.join_group_event($1, $2)", [ev, outsider])).error);
      await h.as(bo);
      h.check("a member cannot answer for someone else", !!(await tryQ(db, "select public.join_group_event($1, $2)", [ev, cy])).error);

      // Out without ever saying In is recorded, and differs from no answer.
      await h.as(bo);
      await h.one("select public.leave_group_event($1, $2) as r", [ev, bo]);
      h.check("Out without ever saying In is written down as Out", (await statusOf(ev, bo)) === "cancelled");
      h.check("...while someone who has not answered has no row (no answer)", (await statusOf(ev, cy)) === null);
      h.check("Out took nothing and gave nothing back", (await bal(bo)) === 3 && (await ledger()) === ledger0);
      await h.as(bo);
      h.check("changing your mind: In after Out works", (await h.one("select public.join_group_event($1, $2) as r", [ev, bo])).r === "joined");
      await h.as(ann);
      await h.one("select public.leave_group_event($1, $2) as r", [ev, ann]);
      h.check("In then Out leaves an Out", (await statusOf(ev, ann)) === "cancelled" && (await bal(ann)) === 3 && (await ledger()) === ledger0);

      // The coach marks who was there: no charge.
      await h.as(coach);
      await h.one("select public.mark_group_event_attendee($1, $2, true) as r", [ev, bo]).catch(() => null);
      h.check("the coach marks a member there", (await statusOf(ev, bo)) === "attended");
      h.check("marking someone there charged nothing", (await bal(bo)) === 3 && (await ledger()) === ledger0);
      await h.as(coach);
      await db.query("select public.mark_group_event_attendee($1, $2, false)", [ev, bo]);
      h.check("undoing the mark puts them back to In, still no charge", (await statusOf(ev, bo)) === "joined" && (await bal(bo)) === 3 && (await ledger()) === ledger0);
      await h.as(ann);
      h.check("a member cannot mark attendance", !!(await tryQ(db, "select public.mark_group_event_attendee($1, $2, true)", [ev, bo])).error);

      // The class functions refuse an event: there is no path from an event to the ledger.
      for (const [label, sql, who, params] of [
        ["join a class", "select public.join_group_session($1, $2)", ann, [ev, ann]],
        ["leave a class", "select public.leave_group_session($1, $2)", bo, [ev, bo]],
        ["cancel a class", "select public.cancel_group_session($1)", coach, [ev]],
        ["mark a class attendee", "select public.mark_group_attendee($1, $2, true)", coach, [ev, bo]],
        ["change the spots of a class", "select public.set_group_session_capacity($1, 5)", coach, [ev]],
      ]) {
        await h.as(who);
        const r = await tryQ(db, sql, params);
        h.check(`the class function to ${label} refuses an event`, !!r.error && /group event/.test(r.error), JSON.stringify(r));
      }
      await h.asSuper();
      h.check("...and the waiting-list mover for classes does nothing for an event", (await h.one("select public.promote_group_waitlist($1) as r", [ev])).r.length === 0);
      h.check("nothing above touched a balance or the ledger", (await bal(ann)) === 3 && (await bal(bo)) === 3 && (await bal(cy)) === 3 && (await ledger()) === ledger0);

      // A limited event: the waiting list moves a person in, free.
      await h.as(coach);
      const ev2 = (await h.one("select public.create_group_event($1, 'Small one', $2, $3, null, null, 1) as id", [group, inDays(25), inDays(25, 1)])).id;
      await h.as(ann);
      h.check("first In takes the only spot", (await h.one("select public.join_group_event($1, $2) as r", [ev2, ann])).r === "joined");
      await h.as(cy);
      h.check("second In goes on the waiting list", (await h.one("select public.join_group_event($1, $2) as r", [ev2, cy])).r === "waitlisted");
      await h.as(ann);
      const moved = (await h.one("select public.leave_group_event($1, $2) as p", [ev2, ann])).p;
      h.check("when the first goes Out, the next person waiting moves in", moved.length === 1 && moved[0] === cy && (await statusOf(ev2, cy)) === "joined", JSON.stringify(moved));
      h.check("the waiting list moved a person in for free: no balance or ledger change", (await bal(cy)) === 3 && (await bal(ann)) === 3 && (await ledger()) === ledger0);

      // Cancelling: everyone In or waiting is returned, nothing to refund.
      await h.as(coach);
      const told = (await h.one("select public.cancel_group_event($1) as a", [ev])).a;
      h.check("cancelling the event returns who was In (so they can be told)", told.includes(bo), JSON.stringify(told));
      h.check("cancelling an event refunded nothing and charged nothing", (await bal(bo)) === 3 && (await ledger()) === ledger0);
      await h.as(coach);
      h.check("the event's held time is free again", !!(await tryQ(db, "select public.book_session($1, $2, $3, $4, $5) as id", [coach, ann, group, startIso, endIso])).rows);
      await h.as(bo);
      h.check("nobody can answer a cancelled event", !!(await tryQ(db, "select public.join_group_event($1, $2)", [ev, bo])).error);
      await h.as(ann);
      h.check("a member cannot cancel an event", !!(await tryQ(db, "select public.cancel_group_event($1)", [ev2])).error);

      // Classes behave exactly as before, and the booked / to-mark counts leave events out.
      await h.asSuper();
      await db.query("delete from public.bookings where athlete_id = $1 and coach_id = $2 and start_at = $3", [ann, coach, startIso]);
      const countsBefore = await h.rows("select * from public.booking_counts(null, $1, null, null)", [ann]);
      h.check("an event does not show up in anyone's booked or to-mark counts", countsBefore.every((r) => Number(r.booked) === 0 && Number(r.to_mark) === 0), JSON.stringify(countsBefore));
      await h.as(coach);
      const cls = (await h.one("select public.create_group_session($1, 'Boot camp', $2, $3, 2) as id", [group, inDays(30), inDays(30, 1)])).id;
      await h.as(ann);
      h.check("a class still takes a session when a client joins it", (await h.one("select public.join_group_session($1, $2) as r", [cls, ann])).r === "joined" && (await bal(ann)) === 2);
      await h.as(coach);
      await db.query("select public.cancel_group_session($1)", [cls]);
      h.check("...and cancelling the class still refunds it", (await bal(ann)) === 3);
      await h.as(ann);
      h.check("the class functions still say 'class not found' for nothing", !!(await tryQ(db, "select public.join_group_session($1, $2)", [h.uuid(99), ann])).error);

      // The feed post points at its event and goes with it.
      await h.asSuper();
      const post = (await db.query("insert into public.posts (group_id, author_id, post_type, channel, body, group_session_id) values ($1, $2, 'user_post', 'announcements', 'Are you in or out?', $3) returning id", [group, coach, ev2])).rows[0].id;
      await db.query("delete from public.group_sessions where id = $1", [ev2]);
      h.check("deleting an event removes its feed post", (await h.rows("select id from public.posts where id = $1", [post])).length === 0);

      // Who may run the new functions.
      await h.asSuper();
      const acl = await h.one(`select
        bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as authed,
        bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')) as open
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('create_group_event', 'join_group_event', 'leave_group_event', 'cancel_group_event', 'mark_group_event_attendee')`);
      h.check("the event functions are for signed-in people only (not signed-out visitors)", acl.authed === true && acl.open === false, JSON.stringify(acl));
      await h.as(null);
      h.check("a signed-out visitor cannot say In", !!(await tryQ(db, "select public.join_group_event($1, $2)", [ev, ann])).error);
    },
  },
};
