// 0271: functions are runnable by signed-in users and the server only (not the public or the signed-out role), except the three public pages'
// own. 0272: the two public forms' functions are server-only. The openness exists on the live schema today (anything created in public is
// executable by everyone); this proves it, proves the fix, and proves the app's own paths (row security, booking, completion) still work.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const at = (days, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();
const canRun = async (h, role, sig) => (await h.one(`select has_function_privilege($1, $2, 'execute') as ok`, [role, sig])).ok;

const BOOK = "public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)";
const IS_COACH = "public.is_group_coach(uuid)";
const INVITE = "public.get_invite_info(text)";
const DISCOVERY = "public.book_discovery_call(uuid, timestamptz, timestamptz, text, text, text, text)";
const LEAD = "public.submit_gym_visitor_lead(uuid, uuid, text, text, text)";

export default {
  name: "0271 function permissions: signed-in and server only; 0272 public forms server-only",
  migrations: ["0271", "0272"],
  phases: {
    async live({ db, h, state }) {
      const coach = await h.user("Acl Coach");
      const ann = await h.user("Acl Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Acl group");
      await h.member(group, ann);
      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5)`, [ann, group]);
      Object.assign(state, { coach, ann, group });
      await h.asSuper();
      h.check("baseline: on the live schema the signed-out role can run book_session", await canRun(h, "anon", BOOK));
      h.check("baseline: and the row-security helpers", await canRun(h, "anon", IS_COACH));
    },

    async "0271"({ db, h, state }) {
      const { coach, ann, group } = state;
      await h.asSuper();
      h.check("the signed-out role can no longer run book_session or the helpers", !(await canRun(h, "anon", BOOK)) && !(await canRun(h, "anon", IS_COACH)));
      const pub = await h.one(`select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as ok`, [BOOK]);
      h.check("nor is it executable by the public (everyone) role", !pub.ok);
      h.check("signed-in users and the server still can", (await canRun(h, "authenticated", BOOK)) && (await canRun(h, "authenticated", IS_COACH)) && (await canRun(h, "service_role", BOOK)));
      h.check("the three public pages' functions stay open to a signed-out visitor", (await canRun(h, "anon", INVITE)) && (await canRun(h, "anon", DISCOVERY)) && (await canRun(h, "anon", LEAD)));

      // the signed-out role is refused when it tries
      await h.as(null);
      const anonBook = await tryQ(db, `select public.book_session($1, $2, $3, $4, $5)`, [coach, ann, group, at(5), at(5, 1)]);
      h.check("a signed-out call to book_session is refused", /permission denied/i.test(anonBook.error ?? ""), JSON.stringify(anonBook));
      const anonHelper = await tryQ(db, `select public.is_group_coach($1)`, [group]);
      h.check("and to a row-security helper", /permission denied/i.test(anonHelper.error ?? ""), JSON.stringify(anonHelper));
      const anonInvite = await tryQ(db, `select * from public.get_invite_info('nope')`);
      h.check("but the invite page's lookup still runs signed out", !anonInvite.error || !/permission denied/i.test(anonInvite.error), JSON.stringify(anonInvite));

      // the app's own paths still work for signed-in people (row security calls the helpers as the caller)
      await h.as(coach);
      const rows = await tryQ(db, `select count(*)::int as n from public.group_memberships where group_id = $1`, [group]);
      h.check("a coach can still read their group's members (row security helpers run for signed-in users)", !rows.error && rows.rows[0].n === 2, JSON.stringify(rows));
      await h.as(ann);
      const booked = await tryQ(db, `select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, at(7), at(7, 1)]);
      h.check("a client can still book a session through book_session", !booked.error && !!booked.rows?.[0]?.id, JSON.stringify(booked));
      const mine = await tryQ(db, `select count(*)::int as n from public.session_credits where athlete_id = $1`, [ann]);
      h.check("and read their own balance", !mine.error && mine.rows[0].n === 1, JSON.stringify(mine));

      // functions created from now on are closed by default
      await h.asSuper();
      await db.query(`create function public.zz_new_fn() returns int language sql as $$ select 1 $$`);
      h.check("a function created after 0271 is not runnable by the signed-out role unless granted on purpose", !(await canRun(h, "anon", "public.zz_new_fn()")));
      h.check("but signed-in users and the server can run it (their defaults are kept)", (await canRun(h, "authenticated", "public.zz_new_fn()")) && (await canRun(h, "service_role", "public.zz_new_fn()")));
      await db.query(`drop function public.zz_new_fn()`);
    },

    async "0272"({ db, h, state }) {
      await h.asSuper();
      h.check("the discovery-call and gym-lead functions are no longer runnable by a signed-out visitor", !(await canRun(h, "anon", DISCOVERY)) && !(await canRun(h, "anon", LEAD)));
      h.check("nor by a signed-in user straight from the browser", !(await canRun(h, "authenticated", DISCOVERY)) && !(await canRun(h, "authenticated", LEAD)));
      h.check("the server still can", (await canRun(h, "service_role", DISCOVERY)) && (await canRun(h, "service_role", LEAD)));
      h.check("the invite lookup is still open to a signed-out visitor", await canRun(h, "anon", INVITE));
      // A permanent guard: exactly this list may be runnable by the signed-out role, so a later migration cannot quietly reopen the door.
      const open = (await h.rows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).map((r) => r.proname);
      h.check("after 0272 the only function the signed-out role can run is get_invite_info", open.length === 1 && open[0] === "get_invite_info", JSON.stringify(open));
    },
  },
};
