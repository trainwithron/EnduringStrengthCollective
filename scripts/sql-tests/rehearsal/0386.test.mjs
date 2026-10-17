// 0386 + 0388: a client's health form and waiver are finished by the server. 0386 only adds (the guard function and a coach's decision on a flagged screening), so the old form keeps working until the new code is
// live. 0388 then switches the guard on: a signed-in client cannot write the completion columns of client_intake (answers, signed name, accepted, completed time) any more, on insert or update, but still writes
// their date of birth; the server (service role / database owner) still can.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0386 The server finishes the health form (0386 adds, 0388 switches the guard on)",
  migrations: ["0386", "0388"],
  phases: {
    async "0386"({ db, h, state }) {
      const coach = await h.user("IS Coach");
      const client = await h.user("IS Client");
      const other = await h.user("IS Other Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "IS team");
      await h.member(group, client);
      await h.member(group, other);
      Object.assign(state, { coach, client, other, group });

      // ---- the old form keeps working until the guard is switched on
      await h.as(other);
      const old = await tryQ(
        db,
        `insert into public.client_intake (athlete_id, group_id, par_q_answers, waiver_signed_name, waiver_accepted, completed_at, date_of_birth)
         values ($1, $2, '[{"question":"q","answer":false}]'::jsonb, 'Old Form Name', true, now(), '1990-01-01') returning completed_at, waiver_accepted`,
        [other, group]
      );
      h.check("after 0386 alone the old form can still finish itself (nothing is refused until 0388)" + (old.error ? ": " + old.error : ""), !old.error && old.rows?.[0]?.waiver_accepted === true && !!old.rows?.[0]?.completed_at);
      const oldUpdate = await tryQ(db, `update public.client_intake set waiver_signed_name = 'Old Form Name 2' where athlete_id = $1 returning athlete_id`, [other]);
      h.check("...and update its completion columns" + (oldUpdate.error ? ": " + oldUpdate.error : ""), !oldUpdate.error);
      await h.asSuper();
      await db.query(`delete from public.client_intake where athlete_id = $1`, [other]);

      // ---- the coach's decision on a flagged screening
      await h.as(coach);
      const ack = await tryQ(
        db,
        `insert into public.athlete_injury_flag_acknowledgements (coach_id, athlete_id, flagged_count, decision, note) values ($1, $2, 2, 'modified', 'No overhead pressing for now') returning decision`,
        [coach, client]
      );
      h.check("a coach can record a decision with a note" + (ack.error ? ": " + ack.error : ""), !ack.error && ack.rows?.[0]?.decision === "modified");
      const bad = await tryQ(db, `update public.athlete_injury_flag_acknowledgements set decision = 'banana' where coach_id = $1 and athlete_id = $2`, [coach, client]);
      h.check("a made-up decision is refused", !!bad.error && /decision_check/.test(bad.error), bad.error);
      const long = await tryQ(db, `update public.athlete_injury_flag_acknowledgements set note = $3 where coach_id = $1 and athlete_id = $2`, [coach, client, "x".repeat(501)]);
      h.check("a note over 500 characters is refused", !!long.error && /note_length/.test(long.error), long.error);

      // ---- permissions
      await h.asSuper();
      const acl = await h.one(`select has_function_privilege('authenticated', 'public.client_intake_guard_completion()', 'execute') as a, has_function_privilege('anon', 'public.client_intake_guard_completion()', 'execute') as b`);
      h.check("the guard function is not callable by signed-in people or visitors", acl.a === false && acl.b === false, JSON.stringify(acl));
    },

    async "0388"({ db, h, state }) {
      const { client, group } = state;

      // ---- insert: whatever the browser sends for the completion columns is ignored
      await h.as(client);
      const ins = await tryQ(
        db,
        `insert into public.client_intake (athlete_id, group_id, par_q_answers, waiver_signed_name, waiver_accepted, completed_at, date_of_birth)
         values ($1, $2, '[{"question":"q","answer":false}]'::jsonb, 'Forged Name', true, now(), '1990-01-01') returning completed_at, waiver_accepted, waiver_signed_name, par_q_answers, date_of_birth::text as date_of_birth`,
        [client, group]
      );
      h.check("a client can create their own intake row with a date of birth" + (ins.error ? ": " + ins.error : ""), !ins.error && String(ins.rows?.[0]?.date_of_birth).startsWith("1990-01-01"));
      h.check("...but cannot make it complete on the way in (no time, not accepted, no name, no answers)",
        ins.rows?.[0]?.completed_at === null && ins.rows?.[0]?.waiver_accepted === false && ins.rows?.[0]?.waiver_signed_name === null && JSON.stringify(ins.rows?.[0]?.par_q_answers) === "[]");

      // ---- update: the completion columns are refused, the date of birth is not
      const dob = await tryQ(db, `update public.client_intake set date_of_birth = '1991-02-03' where athlete_id = $1 returning date_of_birth`, [client]);
      h.check("a client can still correct their date of birth before the form is done" + (dob.error ? ": " + dob.error : ""), !dob.error && dob.rows?.length === 1);
      for (const [label, sql] of [
        ["mark the form complete", `update public.client_intake set completed_at = now() where athlete_id = $1`],
        ["accept the waiver", `update public.client_intake set waiver_accepted = true where athlete_id = $1`],
        ["sign with a name", `update public.client_intake set waiver_signed_name = 'Someone' where athlete_id = $1`],
        ["write answers", `update public.client_intake set par_q_answers = '[{"question":"q","answer":false}]'::jsonb where athlete_id = $1`],
      ]) {
        const r = await tryQ(db, sql, [client]);
        h.check(`a client cannot ${label} from the browser`, !!r.error && /saved by the server/.test(r.error), r.error);
      }

      // ---- the server can
      await h.asSuper();
      const server = await tryQ(
        db,
        `update public.client_intake set par_q_answers = '[{"question":"q","answer":true}]'::jsonb, waiver_signed_name = 'Real Name', waiver_accepted = true, completed_at = now() where athlete_id = $1 returning completed_at`,
        [client]
      );
      h.check("the server (not a signed-in person) can finish the form" + (server.error ? ": " + server.error : ""), !server.error && !!server.rows?.[0]?.completed_at);
      await h.as(client);
      const after = await tryQ(db, `update public.client_intake set waiver_signed_name = 'Changed' where athlete_id = $1 returning athlete_id`, [client]);
      h.check("once finished it still cannot be rewritten by the client", !!after.error || after.rows?.length === 0, after.error);
    },
  },
};
