// 0369: the AI you can train. Past AI build notes are the coach's private notes on a client (the client never reads them, another coach never does, they go with the client); a taught rule can have no
// from/to and is private to the coach; a bad rule kind or scope is refused; the old swap rules and events still work; a correction can be recorded with its reason.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0369 Past AI build notes and taught rules",
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
      await db.query(`insert into public.client_ai_notes (coach_id, athlete_id, group_id, bullets, raw) values ($1, $2, $3, '[{"text":"Cannot rotate: maximize rotation elsewhere","date":"2026-10-14"}]', '[{"text":"Rob cannot rotate","at":"2026-10-14T12:00:00Z"}]')`, [coach, client, group]);
      h.check("a coach can keep notes on their client", (await db.query(`select jsonb_array_length(bullets)::int as n from public.client_ai_notes where athlete_id = $1`, [client])).rows[0].n === 1);
      h.check("one row per coach and client", (await msg(db, `insert into public.client_ai_notes (coach_id, athlete_id, group_id) values ($1, $2, $3)`, [coach, client, group])).includes("duplicate"));
      h.check("a coach cannot write notes as another coach", (await msg(db, `insert into public.client_ai_notes (coach_id, athlete_id, group_id) values ($1, $2, $3)`, [other, client, group])).length > 0);
      h.check("a coach cannot put notes on a client of a group they do not coach", (await msg(db, `insert into public.client_ai_notes (coach_id, athlete_id, group_id) values ($1, $2, $3)`, [coach, client, otherGroup])).length > 0);

      await db.query(
        `insert into public.coach_learned_rules (coach_id, kind, from_name, to_name, status, evidence_count, evidence_total, then_text, when_keys, scope, source, confirmations) values ($1, 'avoid', null, null, 'confirmed', 1, 1, 'No barbell squats', array['back_limit'], 'context', 'pause_correction', 1)`,
        [coach]
      );
      h.check("a taught rule needs no from/to and keeps its context", (await db.query(`select when_keys, scope from public.coach_learned_rules where coach_id = $1 and kind = 'avoid'`, [coach])).rows[0].when_keys[0] === "back_limit");
      h.check("an unknown rule kind is refused", (await msg(db, `insert into public.coach_learned_rules (coach_id, kind, status, evidence_count, evidence_total) values ($1, 'mystery', 'confirmed', 1, 1)`, [coach])).includes("kind_check"));
      h.check("an unknown scope is refused", (await msg(db, `insert into public.coach_learned_rules (coach_id, kind, status, evidence_count, evidence_total, scope) values ($1, 'avoid', 'confirmed', 1, 1, 'everyone')`, [coach])).includes("scope_check"));
      await db.query(`insert into public.coach_learned_rules (coach_id, kind, from_name, to_name, status, evidence_count, evidence_total) values ($1, 'swap', 'Walking Lunge', 'Reverse Lunge', 'suggested', 5, 6)`, [coach]);
      h.check("the old swap rule still works and is for all clients", (await db.query(`select scope from public.coach_learned_rules where kind = 'swap' and coach_id = $1`, [coach])).rows[0].scope === "all");

      await db.query(`insert into public.coach_edit_events (coach_id, program_id, kind, detail, context, why, reason_tags, source) values ($1, $2, 'correction', '{"text":"no barbell squats, his back"}', '{"tags":["back_limit"]}', 'his back', array['injury_or_limit'], 'pause_correction')`, [coach, prog]);
      h.check("a correction is recorded with its context and reason", (await db.query(`select count(*)::int as n from public.coach_edit_events where kind = 'correction' and coach_id = $1`, [coach])).rows[0].n === 1);

      await h.as(other);
      h.check("another coach sees none of the notes or rules", (await db.query(`select (select count(*)::int from public.client_ai_notes) + (select count(*)::int from public.coach_learned_rules) as n`)).rows[0].n === 0);
      await h.as(client);
      h.check("the client never reads their own notes", (await db.query(`select count(*)::int as n from public.client_ai_notes`)).rows[0].n === 0);

      // The organization wall: a coach who works in TWO organizations, with the request naming the workspace of one of them, reads none of the other organization's client notes, even by a direct query.
      await h.asSuper();
      const ownerB = await h.user("TR Owner B");
      const both = await h.user("TR Coach Both");
      const clientA = await h.user("TR Client A");
      const clientB = await h.user("TR Client B");
      const orgA = await h.org(both);
      const orgB = await h.org(ownerB);
      await h.orgMember(orgB, both, "coach");
      const gA = await h.group(orgA, both, "team", "TR wall A");
      const gB = await h.group(orgB, both, "team", "TR wall B");
      await h.member(gA, clientA);
      await h.member(gB, clientB);
      await h.asSuper();
      await db.query(`insert into public.client_ai_notes (coach_id, athlete_id, group_id, bullets) values ($1, $2, $3, '[{"text":"A note","date":"2026-10-14"}]'), ($1, $4, $5, '[{"text":"B note","date":"2026-10-14"}]')`, [both, clientA, gA, clientB, gB]);
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select true $$`);
      const header = (g) => db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "x-workspace-group": g })]);
      const seen = async () => (await db.query(`select athlete_id from public.client_ai_notes order by 1`)).rows.map((r) => r.athlete_id);
      await h.as(both);
      await header(gA);
      h.check("workspace A: only organization A's client notes are readable", JSON.stringify(await seen()) === JSON.stringify([clientA]));
      await header(gB);
      h.check("workspace B: only organization B's client notes are readable", JSON.stringify(await seen()) === JSON.stringify([clientB]));
      await header(gA);
      h.check("workspace A: writing a note into organization B's client is refused", (await msg(db, `insert into public.client_ai_notes (coach_id, athlete_id, group_id) values ($1, $2, $3)`, [both, clientB, gB])).length > 0);
      await h.asSuper();
      await db.query(`select set_config('request.headers', '{}', false)`);
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select false $$`);

      await h.asSuper();
      await db.query(`delete from public.profiles where id = $1`, [client]).catch(() => {});
      h.check("the notes go with the client", (await db.query(`select count(*)::int as n from public.client_ai_notes where athlete_id = $1`, [client])).rows[0].n === 0);
    },
  },
};
