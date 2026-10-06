// 0281: a coach can set a client aside as inactive (reversibly, nothing deleted), and a workout, a booking or a message from the client brings them
// back. A message the COACH sends does not. Before 0281 there is no such status.
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
const inactive = async (h, s) => (await h.one(`select inactive_at, inactive_note from public.group_memberships where group_id = $1 and profile_id = $2`, [s.group, s.ann]));

export default {
  name: "0281 inactive clients (reversible, resurface on activity)",
  migrations: ["0281"],
  phases: {
    async "0280"({ db, h }) {
      const c = await h.one(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'inactive_at'`);
      h.check("baseline: there is no inactive status yet (what 0281 adds)", c.n === 0, JSON.stringify(c));
    },

    async "0281"({ db, h }) {
      const s = await setup(db, h, "I1");
      h.check("every existing client is active", (await inactive(h, s)).inactive_at === null, "");

      await h.as(s.ann);
      const byClient = await tryQ(db, `select public.set_client_inactive($1, $2, true, null)`, [s.ann, s.group]);
      await h.as(s.other);
      const byOther = await tryQ(db, `select public.set_client_inactive($1, $2, true, null)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("a client or an unrelated coach cannot set anyone inactive", !!byClient.error && !!byOther.error && (await inactive(h, s)).inactive_at === null, JSON.stringify({ byClient, byOther }));

      await h.as(s.coach);
      const ok = await tryQ(db, `select public.set_client_inactive($1, $2, true, 'Moved away')`, [s.ann, s.group]);
      await h.asSuper();
      let row = await inactive(h, s);
      h.check("the coach sets a client aside with a note", !ok.error && !!row.inactive_at && row.inactive_note === "Moved away", JSON.stringify({ ok, row }));
      const kept = await h.one(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'athlete'`, [s.group, s.ann]);
      h.check("nothing is deleted: the client is still a member", kept.n === 1, JSON.stringify(kept));

      const missing = await h.user("I1 Stranger");
      await h.as(s.coach);
      const notIn = await tryQ(db, `select public.set_client_inactive($1, $2, true, null)`, [missing, s.group]);
      await h.asSuper();
      h.check("someone who is not a client of the group is refused plainly", /not in this group/.test(notIn.error ?? ""), JSON.stringify(notIn));

      // the coach's own message does not bring them back
      await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'Door is open')`, [s.group, s.coach, s.ann]);
      row = await inactive(h, s);
      h.check("a message the coach sends does not bring the client back", !!row.inactive_at, JSON.stringify(row));

      // their activity does
      await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'Hi coach')`, [s.group, s.ann, s.coach]);
      row = await inactive(h, s);
      h.check("a message from the client brings them back, clearing the note", row.inactive_at === null && row.inactive_note === null, JSON.stringify(row));

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
        h.check(`${label} brings the client back`, !ins.error && row.inactive_at === null, JSON.stringify({ ins, row }));
      }

      // reversible by the coach
      await h.as(s.coach);
      await tryQ(db, `select public.set_client_inactive($1, $2, true, null)`, [s.ann, s.group]);
      const back = await tryQ(db, `select public.set_client_inactive($1, $2, false, null)`, [s.ann, s.group]);
      await h.asSuper();
      h.check("the coach can bring a client back", !back.error && (await inactive(h, s)).inactive_at === null, JSON.stringify(back));

      const priv = await h.one(`select has_function_privilege('anon', 'public.set_client_inactive(uuid, uuid, boolean, text)', 'execute') as a`);
      h.check("the function is closed to the signed-out role", priv.a === false, JSON.stringify(priv));
    },
  },
};
