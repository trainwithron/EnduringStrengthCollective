// 0282: the internal, server-only functions that 0271 re-opened to every signed-in account are closed again. A signed-in client could call
// apply_session_credit_change and add sessions to their own balance. The functions people actually use still work (they call the internals as the
// database owner), and the server keeps access (except the audit writers, which only triggers call).
import { SERVER_ONLY_SIGNATURES, AUDIT_WRITERS } from "../../function-acl.mjs";

const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const at = (days, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();
const sig = (n, a) => `public.${n}(${a})`;

async function setup(db, h, label) {
  const coach = await h.user(`${label} Coach`);
  const ann = await h.user(`${label} Ann`);
  const org = await h.org(coach);
  const group = await h.group(org, coach, "one_on_one", `${label} group`);
  await h.member(group, ann);
  await h.asSuper();
  await db.query(`insert into public.session_credits (athlete_id, group_id, balance, last_granted_at) values ($1, $2, 5, now())`, [ann, group]);
  await db.query(`insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note) values ($1, $2, 'expired', -9, 5, 'Unused sessions expired')`, [ann, group]);
  return { coach, ann, group };
}
const bal = async (h, s) => (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [s.ann, s.group])).balance;

export default {
  name: "0282 internal functions are server-only again",
  migrations: ["0282"],
  phases: {
    async "0281"({ db, h }) {
      // The live database today: 0271 (already applied there, before it was fixed) handed every function to signed-in users. Reproduce that state.
      await h.asSuper();
      for (const [n, a] of SERVER_ONLY_SIGNATURES) await db.query(`grant execute on function ${sig(n, a)} to authenticated, service_role`);
      const s = await setup(db, h, "F0");
      const open = await h.one(`select bool_and(has_function_privilege('authenticated', '${sig(SERVER_ONLY_SIGNATURES[0][0], SERVER_ONLY_SIGNATURES[0][1])}', 'execute')) as a`);
      await h.as(s.ann);
      const hole = await tryQ(db, `select public.apply_session_credit_change($1, $2, 5, 'adjusted', 'self-service', null, $1) as b`, [s.ann, s.group]);
      await h.asSuper();
      h.check("baseline (the live state): a signed-in client can give themselves sessions by calling the internal credit function", open.a === true && !hole.error && (await bal(h, s)) === 10, JSON.stringify({ open, hole }));
    },

    async "0282"({ db, h }) {
      const s = await setup(db, h, "F1");

      for (const [n, a, audit] of SERVER_ONLY_SIGNATURES) {
        const r = await h.one(`select has_function_privilege('authenticated', '${sig(n, a)}', 'execute') as authed, has_function_privilege('anon', '${sig(n, a)}', 'execute') as anon_x, has_function_privilege('service_role', '${sig(n, a)}', 'execute') as svc`);
        h.check(`${n} is closed to signed-in and signed-out users` + (audit ? " and to the server" : " and open to the server"), r.authed === false && r.anon_x === false && r.svc === !audit, JSON.stringify(r));
      }

      // the actual hole is shut
      await h.as(s.ann);
      const self = await tryQ(db, `select public.apply_session_credit_change($1, $2, 5, 'adjusted', 'self-service', null, $1)`, [s.ann, s.group]);
      await h.as(s.coach);
      const byCoach = await tryQ(db, `select public.apply_session_credit_change($1, $2, 5, 'adjusted', 'coach direct', null, $3)`, [s.ann, s.group, s.coach]);
      const settle = await tryQ(db, `select public.settle_booking_internal($1, 1, 'x', null, null, null)`, ["00000000-0000-4000-8000-0000000000ff"]);
      const forge = await tryQ(db, `select public.audit_record('session_credits', 'x', 'update', '{}'::jsonb)`);
      const wait = await tryQ(db, `select public.promote_group_waitlist($1)`, [s.group]);
      await h.asSuper();
      h.check("a signed-in client or coach calling the credit, settle, audit or waiting-list internals is refused (permission denied)", [self, byCoach, settle, forge, wait].every((r) => /permission denied/.test(r.error ?? "")) && (await bal(h, s)) === 5, JSON.stringify({ self, byCoach, settle, forge, wait }));

      // the server still can (except the audit writers)
      await h.asService();
      const svc = await tryQ(db, `select public.apply_session_credit_change($1, $2, 1, 'adjusted', 'server', null, null) as b`, [s.ann, s.group]);
      const svcAudit = await tryQ(db, `select public.audit_record('session_credits', 'x', 'update', '{}'::jsonb)`);
      await h.asSuper();
      h.check("the server can still change a balance; nobody can call the audit writer directly", !svc.error && svc.rows?.[0]?.b === 6 && /permission denied/.test(svcAudit.error ?? ""), JSON.stringify({ svc, svcAudit }));

      // the functions people use still work, because they call the internals as their owner
      await h.as(s.coach);
      const booked = await tryQ(db, `select public.book_session($1, $2, $3, $4, $5) as id`, [s.coach, s.ann, s.group, at(5), at(5, 1)]);
      const cancelled = booked.rows?.[0]?.id ? await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [booked.rows[0].id]) : { error: "no booking" };
      const back = await tryQ(db, `select public.reinstate_expired_credits($1, $2, 2, 'ok') as b`, [s.ann, s.group]);
      await h.asSuper();
      h.check("a coach can still book a session, cancel it with the refund, and give expired sessions back", !booked.error && !cancelled.error && !back.error && back.rows?.[0]?.b === 8, JSON.stringify({ booked, cancelled, back }));
      h.check("the audit trail still records balance changes made through those functions", (await h.one(`select count(*)::int as n from public.audit_log where table_name = 'session_credits'`)).n >= 1, "");
    },
  },
};
