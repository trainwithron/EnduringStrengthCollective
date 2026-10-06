// 0281: a coach can set a client aside as inactive (reversibly, nothing deleted, kept in a coach-only table), and a workout, a booking or a message from
// the client brings them back. A message the COACH sends does not, and neither does a booking the server makes by itself. Before 0281 there is no such status.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

async function setup(db, h, label) {
  const coach = await h.user(`${label} Coach`);
  const ann = await h.user(`${label} Ann`);
  const other = await h.user(`${label} Other Coach`);
  const org = await h.org(coach);
  const group = await h.group(org, coach, "one_on_one", `${label} group`);
  await h.member(group, ann);
  await h.asSuper();
  return { coach, ann, other, group };
}
const inactive = async (h, s) => (await h.rows(`select since, note from public.client_inactive where group_id = $1 and athlete_id = $2`, [s.group, s.ann]))[0] ?? null;

export default {
  name: "0281 inactive clients (coach-only, reversible, resurface on activity)",
  migrations: ["0281"],
  phases: {
    async "0280"({ db, h }) {
      const c = await h.one(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'client_inactive'`);
      h.check("baseline: there is no inactive status yet (what 0281 adds)", c.n === 0, JSON.stringify(c));
    },

    async "0281"({ db, h }) {
      const s = await setup(db, h, "I1");
      h.check("every existing client is active", (await inactive(h, s)) === null, "");

      await h.as(s.ann);
      const byClient = await tryQ(db, `select public.set_client_inactive($1, $2, true, null)`, [s.ann, s.group]);
      await h.as(s.other);
      const byOther = await tryQ(db, `select public.set_client_inactive($1, $2, true, null)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("a client or an unrelated coach cannot set anyone inactive", !!byClient.error && !!byOther.error && (await inactive(h, s)) === null, JSON.stringify({ byClient, byOther }));

      await h.as(s.coach);
      const ok = await tryQ(db, `select public.set_client_inactive($1, $2, true, 'Moved away')`, [s.ann, s.group]);
      await h.asSuper();
      let row = await inactive(h, s);
      h.check("the coach sets a client aside with a note", !ok.error && !!row && row.note === "Moved away", JSON.stringify({ ok, row }));
      const kept = await h.one(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'athlete'`, [s.group, s.ann]);
      h.check("nothing is deleted: the client is still a member", kept.n === 1, JSON.stringify(kept));

      // coach-only: the client, an unrelated coach and a teammate cannot read it
      await h.as(s.ann);
      const seenByClient = await tryQ(db, `select count(*)::int as n from public.client_inactive`);
      await h.as(s.other);
      const seenByOther = await tryQ(db, `select count(*)::int as n from public.client_inactive`);
      await h.as(s.coach);
      const seenByCoach = await tryQ(db, `select count(*)::int as n from public.client_inactive`);
      const direct = await tryQ(db, `insert into public.client_inactive (athlete_id, group_id) values ($1, $2) on conflict do nothing`, [s.ann, s.group]);
      await h.asSuper();
      h.check("the status and the note are coach-only: the client and an unrelated coach see nothing", seenByClient.rows?.[0]?.n === 0 && seenByOther.rows?.[0]?.n === 0 && seenByCoach.rows?.[0]?.n === 1, JSON.stringify({ seenByClient, seenByOther, seenByCoach }));
      h.check("nobody writes the table directly, not even the coach", !!direct.error, JSON.stringify(direct));
      const memberCols = await h.one(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name like 'inactive%'`);
      h.check("no inactive column is added to group_memberships (it is readable by every member)", memberCols.n === 0, JSON.stringify(memberCols));

      const missing = await h.user("I1 Stranger");
      await h.as(s.coach);
      const notIn = await tryQ(db, `select public.set_client_inactive($1, $2, true, null)`, [missing, s.group]);
      await h.asSuper();
      h.check("someone who is not a client of the group is refused plainly", /not in this group/.test(notIn.error ?? ""), JSON.stringify(notIn));

      // the coach's own message does not bring them back
      await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'Door is open')`, [s.group, s.coach, s.ann]);
      row = await inactive(h, s);
      h.check("a message the coach sends does not bring the client back", !!row, JSON.stringify(row));

      // a booking the server makes by itself (the nightly top-up of a weekly schedule) does not either
      await h.asService();
      const auto = await tryQ(db, `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1, $2, $3, now() + interval '9 days', now() + interval '9 days 1 hour', 'confirmed', 'unsettled')`, [s.coach, s.ann, s.group]);
      await h.asSuper();
      row = await inactive(h, s);
      h.check("a booking the server makes by itself does not bring the client back", !auto.error && !!row, JSON.stringify({ auto, row }));

      // their activity does
      await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'Hi coach')`, [s.group, s.ann, s.coach]);
      row = await inactive(h, s);
      h.check("a message from the client brings them back, clearing the note", row === null, JSON.stringify(row));

      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id`, [s.group, s.coach])).rows[0].id;
      const workout = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day', 1) returning id`, [prog, s.group])).rows[0].id;
      const sess = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, status) values ($1, $2, $3, 'completed') returning id`, [workout, s.group, s.ann])).rows[0].id;
      for (const [label, sql, args] of [
        ["a booking", `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1, $2, $3, now() + interval '3 days', now() + interval '3 days 1 hour', 'confirmed', 'unsettled')`, [s.coach, s.ann, s.group]],
        ["a logged workout", `insert into public.workout_logs (session_id, athlete_id, group_id) values ($1, $2, $3)`, [sess, s.ann, s.group]],
      ]) {
        await h.as(s.coach);
        await tryQ(db, `select public.set_client_inactive($1, $2, true, null)`, [s.ann, s.group]);
        await h.asSuper();
        const ins = await tryQ(db, sql, args);
        row = await inactive(h, s);
        h.check(`${label} brings the client back`, !ins.error && row === null, JSON.stringify({ ins, row }));
      }

      // reversible by the coach
      await h.as(s.coach);
      await tryQ(db, `select public.set_client_inactive($1, $2, true, null)`, [s.ann, s.group]);
      const back = await tryQ(db, `select public.set_client_inactive($1, $2, false, null)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("the coach can bring a client back", !back.error && (await inactive(h, s)) === null, JSON.stringify(back));

      const ev = await h.rows(`select event, source from public.client_inactive_events where athlete_id = $1 and group_id = $2 order by id`, [s.ann, s.group]);
      const seq = ev.map((e) => e.event + ":" + e.source).join(",");
      h.check("the log has the coach's bring-back last and the client-activity ones before it", ev.length >= 4 && ev[ev.length - 1].event === "brought_back" && ev[ev.length - 1].source === "coach" && ev.some((e) => e.source === "client_activity"), seq);
      await h.as(s.ann);
      const evClient = await tryQ(db, `select count(*)::int as n from public.client_inactive_events`);
      await h.asSuper();
      h.check("the log is coach-only too", evClient.rows?.[0]?.n === 0, JSON.stringify(evClient));

      const priv = await h.one(`select has_function_privilege('anon', 'public.set_client_inactive(uuid, uuid, boolean, text)', 'execute') as a`);
      h.check("the function is closed to the signed-out role", priv.a === false, JSON.stringify(priv));
    },
  },
};
