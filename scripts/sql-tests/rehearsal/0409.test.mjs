// 0409: money events (failed payment, refund, dispute) are recorded once per Stripe event; a coach reads their own groups', a client their own, nobody writes from a browser; a "payment_problem" notice is allowed
// without losing any existing kind; the platform report is for a platform admin only and finds the four things it says it finds.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0409 Money events",
  migrations: ["0409"],
  phases: {
    async "0409"({ db, h }) {
      const coach = await h.user("PE Coach");
      const other = await h.user("PE Other Coach");
      const client = await h.user("PE Client");
      const gone = await h.user("PE Gone Client");
      const admin = await h.user("PE Admin");
      const orgAdmin = await h.user("PE Org Admin");
      const leaver = await h.user("PE Leaver");
      const undated = await h.user("PE Undated");
      const recovered = await h.user("PE Recovered");
      const org = await h.org(coach, "PE Gym");
      await h.orgMember(org, other, "coach");
      const g = await h.group(org, coach, "team", "PE team");
      const g2 = await h.group(org, other, "team", "PE other team");
      await h.member(g, client);
      await h.member(g, undated);
      await h.member(g, recovered);
      await h.orgMember(org, orgAdmin, "admin");
      await h.member(g, leaver, "coach");

      await h.asSuper();
      await db.query(`update public.profiles set is_platform_admin = true where id = $1`, [admin]);
      const kinds = (await db.query(`select pg_get_constraintdef(c.oid) as d from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass`)).rows[0].d;
      h.check("the notice list now has payment_problem", kinds.includes("'payment_problem'"));
      h.check("and still has the kinds it had (payment_received, request_decision, late_change, space_invite)", ["payment_received", "request_decision", "late_change", "space_invite", "email_change_requested"].every((k) => kinds.includes(`'${k}'`)), kinds);
      await db.query(`insert into public.notifications (profile_id, group_id, type, body, link_path) values ($1, $2, 'payment_problem', 'x', '/dashboard')`, [coach, g]);
      h.check("a payment_problem notice can be written", (await db.query(`select count(*)::int as n from public.notifications where type = 'payment_problem'`)).rows[0].n === 1);

      // ---- the ledger
      await db.query(`insert into public.payment_events (stripe_event_id, kind, group_id, athlete_id, amount_cents, currency, stripe_object_id) values ('evt_1', 'payment_failed', $1, $2, 5000, 'usd', 'in_1'), ('evt_2', 'refund', $1, $2, 2500, 'usd', 'ch_1'), ('evt_3', 'refund', null, null, 900, 'usd', 'ch_2'), ('evt_4', 'dispute_opened', $1, $2, 2500, 'usd', 'dp_1'), ('evt_5', 'dispute_opened', $1, $2, 1000, 'usd', 'dp_2'), ('evt_6', 'dispute_closed', $1, $2, 1000, 'usd', 'dp_2')`, [g, client]);
      await db.query(`update public.payment_events set subscription_id = 'sub_pastdue', created_at = now() - interval '10 days' where stripe_event_id = 'evt_1'`);
      await db.query(`insert into public.payment_events (stripe_event_id, kind, coach_id, amount_cents, currency, stripe_object_id) values ('evt_own', 'payment_failed', $1, 4900, 'usd', 'in_own')`, [coach]);
      h.check("a Stripe event is recorded once: the same event again is refused", (await msg(db, `insert into public.payment_events (stripe_event_id, kind) values ('evt_1', 'refund')`)).length > 0);
      await db.query(`insert into public.payment_events (stripe_event_id, kind, group_id, athlete_id, amount_cents, stripe_object_id, refund_id) values ('evt_ra', 'refund', $1, $2, 1000, 'ch_1', 're_1')`, [g, client]);
      h.check("a Stripe refund is recorded once: another event carrying the same refund is refused", (await msg(db, `insert into public.payment_events (stripe_event_id, kind, refund_id) values ('evt_rb', 'refund', 're_1')`)).length > 0);
      await db.query(`delete from public.payment_events where stripe_event_id = 'evt_ra'`);
      h.check("only the four kinds are allowed", (await msg(db, `insert into public.payment_events (stripe_event_id, kind) values ('evt_x', 'chargeback')`)).length > 0);

      await h.as(coach);
      h.check("the coach of the group reads its money events", (await db.query(`select count(*)::int as n from public.payment_events where group_id = $1`, [g])).rows[0].n === 5);
      h.check("but not the unattributed one", (await db.query(`select count(*)::int as n from public.payment_events where stripe_object_id = 'ch_2'`)).rows[0].n === 0);
      h.check("a browser cannot write a money event", (await msg(db, `insert into public.payment_events (stripe_event_id, kind, group_id) values ('evt_y', 'refund', $1)`, [g])).length > 0);
      h.check("and the coach's own plan problem (no group) is theirs to read", (await db.query(`select count(*)::int as n from public.payment_events where stripe_object_id = 'in_own'`)).rows[0].n === 1);
      await h.as(orgAdmin);
      h.check("an admin of the organization reads its groups' money events", (await db.query(`select count(*)::int as n from public.payment_events where group_id = $1`, [g])).rows[0].n === 5);
      h.check("but not a coach's own plan", (await db.query(`select count(*)::int as n from public.payment_events where stripe_object_id = 'in_own'`)).rows[0].n === 0);
      // ---- a client who keeps their records private from the organization: the admin no longer reads their money events, the group's coach still does
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [g, client]);
      await h.as(orgAdmin);
      h.check("an organization admin does NOT read a private client's money events", (await db.query(`select count(*)::int as n from public.payment_events where group_id = $1`, [g])).rows[0].n === 0);
      await h.as(coach);
      h.check("the group's coach still does", (await db.query(`select count(*)::int as n from public.payment_events where group_id = $1`, [g])).rows[0].n === 5);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = false where group_id = $1 and profile_id = $2`, [g, client]);

      // ---- a coach in two organizations reads one at a time when the request names a workspace (the wall is installed but switched off in production until a step turns it on; here it is turned on and then off again)
      const owner2 = await h.user("PE Owner Two");
      const stranger = await h.user("PE Stranger Client");
      const org2 = await h.org(owner2, "PE Other Gym");
      await h.orgMember(org2, coach, "coach");
      const g3 = await h.group(org2, coach, "team", "PE team two");
      await h.member(g3, stranger);
      await h.asSuper();
      await db.query(`insert into public.payment_events (stripe_event_id, kind, group_id, athlete_id, amount_cents, currency, stripe_object_id) values ('evt_two', 'refund', $1, $2, 700, 'usd', 'ch_two')`, [g3, stranger]);
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select true $$`);
      const header = (gid) => db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "x-workspace-group": gid })]);
      const events = async () => (await db.query(`select stripe_object_id from public.payment_events order by stripe_object_id`)).rows.map((r) => r.stripe_object_id);
      await h.as(coach);
      await header(g);
      const inOne = await events();
      h.check("naming the first organization: only its events (and the coach's own plan)", inOne.includes("in_1") && inOne.includes("in_own") && !inOne.includes("ch_two"), JSON.stringify(inOne));
      await header(g3);
      const inTwo = await events();
      h.check("naming the second organization: only its events (and the coach's own plan)", inTwo.includes("ch_two") && inTwo.includes("in_own") && !inTwo.includes("in_1"), JSON.stringify(inTwo));
      await h.asSuper();
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select false $$`);

      await h.asSuper();
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [g, leaver]);
      await h.as(leaver);
      h.check("a coach who has left the group no longer reads its money events", (await db.query(`select count(*)::int as n from public.payment_events`)).rows[0].n === 0);
      await h.as(other);
      h.check("another coach reads none of them", (await db.query(`select count(*)::int as n from public.payment_events`)).rows[0].n === 0);
      await h.as(client);
      h.check("the client reads their own", (await db.query(`select count(*)::int as n from public.payment_events`)).rows[0].n === 5);
      h.check("and cannot change or delete them", (await db.query(`update public.payment_events set amount_cents = 1 returning 1`).catch(() => ({ rows: [] }))).rows.length === 0);

      // ---- the platform report
      await h.as(coach);
      h.check("a coach cannot run the platform report", (await msg(db, `select * from public.payment_reconciliation_report()`)).includes("platform administrator"));
      await h.as(client);
      h.check("nor a client", (await msg(db, `select * from public.payment_reconciliation_report()`)).includes("platform administrator"));

      await h.asSuper();
      // a subscription past due for 10 days, and one still billing a person who is not in the group
      await db.query(`insert into public.membership_subscriptions (athlete_id, group_id, stripe_subscription_id, status, updated_at) values ($1, $2, 'sub_pastdue', 'past_due', now()), ($6, $2, 'sub_recovered', 'past_due', now()), ($3, $2, 'sub_left', 'active', now()), ($4, $2, 'sub_undated', 'past_due', now() - interval '30 days'), ($5, $2, 'sub_incomplete', 'incomplete', now())`, [client, g, gone, undated, leaver, recovered]);
      // failed 60 days ago (invoice in_a), recovered, failed again yesterday on a new invoice: counted from the new failure, so not flagged
      await db.query(`insert into public.payment_events (stripe_event_id, kind, group_id, athlete_id, amount_cents, stripe_object_id, subscription_id, created_at) values ('evt_r1', 'payment_failed', $1, $2, 5000, 'in_a', 'sub_recovered', now() - interval '60 days'), ('evt_r2', 'payment_failed', $1, $2, 5000, 'in_b', 'sub_recovered', now() - interval '1 day')`, [g, recovered]);
      await h.as(admin);
      const report = (await db.query(`select check_name, issue_count::int as n, example from public.payment_reconciliation_report()`)).rows;
      const by = (name) => report.find((r) => r.check_name === name);
      h.check("the report has the four checks", report.length === 4, JSON.stringify(report));
      h.check("it finds the refund it could not match to a client", by("refund_not_attributed")?.n === 1 && by("refund_not_attributed")?.example === "ch_2", JSON.stringify(by("refund_not_attributed")));
      h.check("the subscription whose latest failed invoice first failed more than 7 days ago (one with no failure recorded, and one that failed, recovered and failed again yesterday, are not counted)", by("past_due_over_7_days")?.n === 1 && by("past_due_over_7_days")?.example === "sub_pastdue", JSON.stringify(by("past_due_over_7_days")));
      h.check("the subscription still billing someone who is not a client of the group", by("billing_after_leaving")?.n === 1 && by("billing_after_leaving")?.example === "sub_left", JSON.stringify(by("billing_after_leaving")));
      h.check("the dispute still open (one opened and closed does not count)", by("dispute_open")?.n === 1 && by("dispute_open")?.example === "dp_1", JSON.stringify(by("dispute_open")));
      await h.asSuper();
      void g2;
    },
  },
};
