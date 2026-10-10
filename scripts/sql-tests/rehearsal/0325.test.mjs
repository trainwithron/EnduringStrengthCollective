// 0325: AI builder learning tables. Everything is private to the coach (row security), a pattern can be asked about only once, statuses and kinds are limited, and deleting a program removes
// what was noted about it. Nothing here touches a program, a client or a safety rule.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0325 AI builder learning is private to the coach",
  migrations: ["0325"],
  phases: {
    async "0325"({ db, h }) {
      const coach = await h.user("LR Coach");
      const other = await h.user("LR Other Coach");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "LR group");
      const org2 = await h.org(other);
      const group2 = await h.group(org2, other, "team", "LR other group");

      await h.asSuper();
      const prog = (await db.query("insert into public.programs (group_id, name, created_by, is_active, ai_draft, ai_snapshot) values ($1, 'AI one', $2, false, true, $3::jsonb) returning id", [group, coach, JSON.stringify([{ week: 1, day: 1, order: 0, name: "Walking Lunge", sets: 3, reps: "8" }])])).rows[0].id;
      const snap = await h.one("select ai_snapshot from public.programs where id = $1", [prog]);
      h.check("a draft keeps what the AI wrote", Array.isArray(snap.ai_snapshot) && snap.ai_snapshot[0].name === "Walking Lunge");

      // The coach writes their own rows.
      await h.as(coach);
      const so = await tryQ(db, "insert into public.coach_program_signoffs (program_id, coach_id, exercises, edits_count) values ($1, $2, array['Walking Lunge'], 1) returning program_id", [prog, coach]);
      h.check("the coach records a sign-off", !so.error, JSON.stringify(so));
      const ev = await tryQ(db, "insert into public.coach_edit_events (coach_id, program_id, kind, from_name, to_name) values ($1, $2, 'swap', 'Walking Lunge', 'Reverse Lunge') returning id", [coach, prog]);
      h.check("the coach records an edit", !ev.error, JSON.stringify(ev));
      const rule = await tryQ(db, "insert into public.coach_learned_rules (coach_id, from_name, to_name, evidence_count, evidence_total, asked_for_program_id) values ($1, 'Walking Lunge', 'Reverse Lunge', 8, 10, $2) returning id, status", [coach, prog]);
      h.check("a rule starts as a suggestion", rule.rows?.[0]?.status === "suggested", JSON.stringify(rule));
      const dup = await tryQ(db, "insert into public.coach_learned_rules (coach_id, from_name, to_name, evidence_count, evidence_total) values ($1, 'Walking Lunge', 'Reverse Lunge', 9, 10)", [coach]);
      h.check("the same pattern can never be asked about twice", !!dup.error, JSON.stringify(dup));
      const badStatus = await tryQ(db, "update public.coach_learned_rules set status = 'applied' where id = $1", [rule.rows[0].id]);
      h.check("only the known statuses are allowed", !!badStatus.error, JSON.stringify(badStatus));
      const badKind = await tryQ(db, "insert into public.coach_edit_events (coach_id, program_id, kind) values ($1, $2, 'nonsense')", [coach, prog]);
      h.check("only the known kinds of change are allowed", !!badKind.error, JSON.stringify(badKind));
      const set = await tryQ(db, "insert into public.coach_learning_settings (coach_id, questions_enabled) values ($1, false) returning questions_enabled", [coach]);
      h.check("the coach can switch the questions off", set.rows?.[0]?.questions_enabled === false, JSON.stringify(set));

      // Another coach sees none of it and cannot write as this coach.
      await h.as(other);
      for (const t of ["coach_program_signoffs", "coach_edit_events", "coach_learned_rules", "coach_learning_settings"]) {
        const n = (await h.one(`select count(*)::int as n from public.${t}`)).n;
        h.check(`another coach cannot read the ${t} rows`, n === 0, String(n));
      }
      const forged = await tryQ(db, "insert into public.coach_learned_rules (coach_id, from_name, to_name, evidence_count, evidence_total) values ($1, 'A', 'B', 5, 5)", [coach]);
      h.check("another coach cannot write a rule as this coach", !!forged.error, JSON.stringify(forged));

      // A signed-out visitor sees nothing.
      await h.as(null);
      const anon = await tryQ(db, "select count(*)::int as n from public.coach_learned_rules");
      h.check("a signed-out visitor sees nothing", !!anon.error || anon.rows[0].n === 0, JSON.stringify(anon));

      // Deleting the program removes what was noted about it.
      await h.asSuper();
      await db.query("delete from public.programs where id = $1", [prog]);
      const left = await h.one("select (select count(*) from public.coach_program_signoffs where coach_id = $1)::int as a, (select count(*) from public.coach_edit_events where coach_id = $1)::int as b", [coach]);
      h.check("deleting a program removes its sign-off and edit notes", left.a === 0 && left.b === 0, JSON.stringify(left));
      void group2;
    },
  },
};
