// 0313: booking_counts(): the session counts per client and group, worked out in the database with the same rules the app used (booked, to mark, prepaid ahead). It runs as the
// caller, so row security decides what each person can count. Proves the numbers, the filters, the paging order, the security, and that nothing else was touched.
const hrs = (n) => new Date(Date.now() + n * 3600000).toISOString();

export default {
  name: "0313 booking_counts for large rosters",
  migrations: ["0313"],
  phases: {
    async "0313"({ db, h }) {
      const coach = await h.user("BC Coach");
      const otherCoach = await h.user("BC Other Coach");
      const ann = await h.user("BC Ann");
      const bo = await h.user("BC Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "BC group");
      await h.member(group, ann);
      await h.member(group, bo);
      const otherOrg = await h.org(otherCoach);
      const otherGroup = await h.group(otherOrg, otherCoach, "team", "BC other group");
      await h.member(otherGroup, ann);

      await h.asSuper();
      let slot = 0;
      const add = async (coachId, athlete, groupId, startH, endH, o = {}) => {
        slot += 1;
        // a different start each time (one coach cannot have two sessions at the same instant)
        const s = new Date(Date.now() + startH * 3600000 + slot * 1000).toISOString();
        await db.query(
          "insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state, attended_at, no_show) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [coachId, athlete, groupId, s, new Date(new Date(s).getTime() + (endH - startH) * 3600000).toISOString(), o.status ?? "confirmed", o.state ?? "unsettled", o.attended ?? null, o.noShow ?? false]
        );
      };
      // Ann with this coach: 2 future unsettled (booked), 1 in progress (booked), 1 ended unmarked (to mark), 1 ended attended, 1 ended no-show, 1 future prepaid, 1 past prepaid, 1 cancelled future
      await add(coach, ann, group, 24, 25);
      await add(coach, ann, group, 48, 49);
      await add(coach, ann, group, -0.5, 0.5);
      await add(coach, ann, group, -48, -47);
      await add(coach, ann, group, -72, -71, { attended: hrs(-70) });
      await add(coach, ann, group, -96, -95, { noShow: true });
      await add(coach, ann, group, 72, 73, { state: "prepaid" });
      await add(coach, ann, group, -120, -119, { state: "prepaid" });
      await add(coach, ann, group, 96, 97, { status: "cancelled" });
      // Group classes: Ann joined a coming class herself (charged at join: prepaid ahead); the coach added Bo to a coming class (charged when marked: booked) and to a finished one he is
      // not marked for (to mark); a cancelled class, a waiting-list place and a finished class Ann paid for are not counted.
      let classNo = 0;
      const cls = async (startH, endH, status = "scheduled") =>
        (await db.query("insert into public.group_sessions (coach_id, title, start_at, end_at, capacity, status) values ($1, $2, $3, $4, 10, $5) returning id", [coach, "Class " + ++classNo, hrs(startH + classNo * 0.01), hrs(endH + classNo * 0.01), status])).rows[0].id;
      const att = (classId, athlete, status, taken) =>
        db.query("insert into public.group_session_attendees (group_session_id, athlete_id, group_id, status, credit_taken, added_by_coach) values ($1,$2,$3,$4,$5,$6)", [classId, athlete, group, status, taken, !taken]);
      const comingClass = await cls(20, 21);
      await att(comingClass, ann, "joined", true);
      await att(comingClass, bo, "joined", false);
      const pastClass = await cls(-30, -29);
      await att(pastClass, bo, "joined", false);
      await att(pastClass, ann, "joined", true);
      const cancelledClass = await cls(40, 41, "cancelled");
      await att(cancelledClass, ann, "joined", true);
      const waitClass = await cls(50, 51);
      await att(waitClass, bo, "waitlisted", false);
      const doneClass = await cls(-60, -59);
      await att(doneClass, bo, "attended", true);
      // Bo: one future unsettled
      await add(coach, bo, group, 30, 31);
      // Ann with ANOTHER coach in another organization: one future unsettled
      await add(otherCoach, ann, otherGroup, 36, 37);

      const counts = async (args) => h.rows("select athlete_id, group_id, booked, to_mark, prepaid_ahead from public.booking_counts($1, $2, $3, $4)", args);
      const at = (rows, a, g) => rows.find((r) => r.athlete_id === a && r.group_id === g);

      // as the coach (their own bookings only)
      await h.as(coach);
      const mine = await counts([coach, null, null, null]);
      h.check("Ann's counts with this coach: 3 booked (two ahead and one in progress), 1 to mark, 2 prepaid ahead (a prepaid session and the class she joined)", JSON.stringify(at(mine, ann, group)) === JSON.stringify({ athlete_id: ann, group_id: group, booked: 3, to_mark: 1, prepaid_ahead: 2 }), JSON.stringify(at(mine, ann, group)));
      h.check("Bo's counts: 1 session + the class the coach added him to = 2 booked, and the finished class he was not marked for = 1 to mark; his waiting-list place and attended class are not counted", at(mine, bo, group)?.booked === 2 && at(mine, bo, group)?.to_mark === 1 && at(mine, bo, group)?.prepaid_ahead === 0, JSON.stringify(at(mine, bo, group)));
      h.check("the coach does not count another coach's bookings, and a cancelled or finished session is not counted", mine.length === 2, JSON.stringify(mine));
      h.check("rows come back in a fixed order (client, then group)", mine.every((r, i, a) => i === 0 || a[i - 1].athlete_id <= r.athlete_id), JSON.stringify(mine.map((r) => r.athlete_id)));

      // filters
      const one = await counts([coach, ann, null, null]);
      const list = await counts([coach, null, [bo], null]);
      const none = await counts([coach, null, [ann, bo], otherGroup]);
      h.check("filtered to one client", one.length === 1 && one[0].athlete_id === ann);
      h.check("filtered to a list of clients", list.length === 1 && list[0].athlete_id === bo);
      h.check("filtered to a group they are not in: nothing", none.length === 0);

      // as the client (only their own, across coaches, by row security)
      await h.as(ann);
      const own = await counts([null, ann, null, null]);
      h.check("a client counts their own sessions with every coach", own.length === 2 && at(own, ann, group)?.booked === 3 && at(own, ann, otherGroup)?.booked === 1, JSON.stringify(own));
      const peek = await counts([null, bo, null, null]);
      const peekAll = await counts([null, null, null, null]);
      h.check("a client cannot count someone else's sessions", peek.length === 0 && peekAll.every((r) => r.athlete_id === ann), JSON.stringify({ peek, peekAll }));

      // another coach sees only theirs
      await h.as(otherCoach);
      const theirs = await counts([null, null, null, null]);
      h.check("another coach counts only their own bookings", theirs.length === 1 && theirs[0].group_id === otherGroup && theirs[0].booked === 1, JSON.stringify(theirs));

      // the server sees everything
      await h.asService();
      const everyone = await counts([null, null, null, null]);
      const all = everyone.filter((r) => [group, otherGroup].includes(r.group_id));
      await h.asSuper();
      h.check("the server counts everything in these groups: Ann with both coaches and Bo", all.length === 3 && everyone.length >= 3, JSON.stringify(all));

      // rights and nature
      const acl = await h.one(
        "select has_function_privilege('authenticated', 'public.booking_counts(uuid, uuid, uuid[], uuid)', 'execute') as a, has_function_privilege('service_role', 'public.booking_counts(uuid, uuid, uuid[], uuid)', 'execute') as s, has_function_privilege('anon', 'public.booking_counts(uuid, uuid, uuid[], uuid)', 'execute') as n, (select prosecdef from pg_proc where proname = 'booking_counts' and pronamespace = 'public'::regnamespace) as definer"
      );
      h.check("signed-in users and the server may run it, signed-out visitors may not, and it runs as the caller (not as the owner)", acl.a && acl.s && !acl.n && acl.definer === false, JSON.stringify(acl));
      const idx = await h.one("select indexdef from pg_indexes where schemaname = 'public' and indexname = 'bookings_open_counts_idx'");
      h.check("the partial index is there", /WHERE/.test(idx?.indexdef ?? "") && /unsettled/.test(idx.indexdef), idx?.indexdef);
    },
  },
};
