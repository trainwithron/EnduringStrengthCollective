// 0369: the AI you can train, first release. Clauses are the coach's private notes on a client (the client never reads them, another coach never reads them); a taught rule can have no from/to and is
// private to the coach; a bad rule kind or scope is refused; the old swap rules and events still work; a correction can be recorded with its reason.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0369 clauses and taught rules",
  migrations: ["0369"],
  phases: {
    async "0369"({ db, h }) {
      const coach = await h.user("TR Coach");
      const other = await h.user("TR Other Coach");
      const client = await h.user("TR Client");
      const org = await h.org(coach);
      await h.orgMember(org, other, "coach");
      const group = await h.group(org, coach, "team", "TR team");
      const otherGroup = await h.group(org, other, "team", "TR other team");
      await h.member(group, client);
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'TR program', $2) returning id`, [group, coach])).rows[0].id;

      await h.as(coach);
      await db.query(`insert into public.client_clauses (coach_id, athlete_id, group_id, key, label) values ($1, $2, $3, 'back_limit', 'Back limits')`, [coach, client, group]);
      h.check("a coach can put a clause on their client", (await db.query(`select count(*)::int as n from public.client_clauses where athlete_id = $1`, [client])).rows[0].n === 1);
      h.check("the same clause twice is refused", (await msg(db, `insert into public.client_clauses (coach_id, athlete_id, group_id, key, label) values ($1, $2, $3, 'back_limit', 'Back limits')`, [coach, client, group])).includes("duplicate") );
      h.check("a clause key must be a plain slug", (await msg(db, `insert into public.client_clauses (coach_id, athlete_id, group_id, key, label) values ($1, $2, $3, 'Bad Key!', 'x')`, [coach, client, group])).includes("key_check"));
      h.check("a coach cannot write a clause as another coach", (await msg(db, `insert into public.client_clauses (coach_id, athlete_id, group_id, key, label) values ($1, $2, $3, 'knee_limit', 'Knee limits')`, [other, client, group])).length > 0);

      await db.query(
        `insert into public.coach_learned_rules (coach_id, kind, from_name, to_name, status, evidence_count, evidence_total, then_text, when_keys, scope, source, confirmations) values ($1, 'avoid', null, null, 'confirmed', 1, 1, 'No barbell squats', array['back_limit'], 'clauses', 'pause_correction', 1)`,
        [coach]
      );
      h.check("a taught rule needs no from/to and keeps its clauses", (await db.query(`select when_keys, scope from public.coach_learned_rules where coach_id = $1 and kind = 'avoid'`, [coach])).rows[0].when_keys[0] === "back_limit");
      h.check("an unknown rule kind is refused", (await msg(db, `insert into public.coach_learned_rules (coach_id, kind, status, evidence_count, evidence_total) values ($1, 'mystery', 'confirmed', 1, 1)`, [coach])).includes("kind_check"));
      h.check("an unknown scope is refused", (await msg(db, `insert into public.coach_learned_rules (coach_id, kind, status, evidence_count, evidence_total, scope) values ($1, 'avoid', 'confirmed', 1, 1, 'everyone')`, [coach])).includes("scope_check"));
      await db.query(`insert into public.coach_learned_rules (coach_id, kind, from_name, to_name, status, evidence_count, evidence_total) values ($1, 'swap', 'Walking Lunge', 'Reverse Lunge', 'suggested', 5, 6)`, [coach]);
      h.check("the old swap rule still works and is for all clients", (await db.query(`select scope from public.coach_learned_rules where kind = 'swap' and coach_id = $1`, [coach])).rows[0].scope === "all");

      await db.query(`insert into public.coach_edit_events (coach_id, program_id, kind, detail, context, why, reason_tags, source) values ($1, $2, 'correction', '{"text":"no barbell squats, his back"}', '{"clauses":["back_limit"]}', 'his back', array['injury_or_limit'], 'pause_correction')`, [coach, prog]);
      h.check("a correction is recorded with its context and reason", (await db.query(`select count(*)::int as n from public.coach_edit_events where kind = 'correction' and coach_id = $1`, [coach])).rows[0].n === 1);

      await h.as(other);
      h.check("another coach sees none of the clauses or rules", (await db.query(`select (select count(*)::int from public.client_clauses) + (select count(*)::int from public.coach_learned_rules) as n`)).rows[0].n === 0);
      await h.as(client);
      h.check("the client never reads their own clauses", (await db.query(`select count(*)::int as n from public.client_clauses`)).rows[0].n === 0);
      void otherGroup;
    },
  },
};
