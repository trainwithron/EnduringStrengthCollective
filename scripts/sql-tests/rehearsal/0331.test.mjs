// 0331: a payment event and its sessions are recorded in ONE step. A first delivery grants; a repeat of a fully handled event changes nothing; a grant that fails leaves NO record
// behind (so the retry grants); only the server can call these.
export default {
  name: "0331 a payment event and its sessions are recorded in one step",
  migrations: ["0331"],
  phases: {
    async "0331"({ db, h }) {
      const coach = await h.user("GP Coach");
      const ann = await h.user("GP Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "GP group");
      await h.member(group, ann);

      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 0)`, [ann, group]);
      const bal = async () => (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [ann, group])).balance;

      // ---- a one-time pack
      await h.asService();
      const first = (await h.one(`select public.grant_purchase_once('evt_1', 'cs_1', $1, $2, null, 5, 25000, 'Package purchased') as r`, [ann, group])).r;
      await h.asSuper();
      h.check("the first delivery grants the sessions and says so", first === true && (await bal()) === 5, `granted ${first}, balance ${await bal()}`);
      const rec = await h.one(`select count(*)::int as n, min(credits_purchased) as c from public.credit_purchases where stripe_event_id = 'evt_1'`);
      h.check("...and records the payment once", rec.n === 1 && rec.c === 5);

      await h.asService();
      const again = (await h.one(`select public.grant_purchase_once('evt_1', 'cs_1', $1, $2, null, 5, 25000, 'Package purchased') as r`, [ann, group])).r;
      await h.asSuper();
      h.check("a repeat of the same event grants nothing more and says false", again === false && (await bal()) === 5);

      // ---- a grant that fails leaves no record, so the retry can grant
      await h.asService();
      const ghost = "00000000-0000-0000-0000-00000000dead";
      await h.expectError("a grant that cannot be made fails the whole step", () => db.query(`select public.grant_purchase_once('evt_2', 'cs_2', $1, $2, null, 3, 100, 'x')`, [ghost, group]), /.+/);
      await h.asSuper();
      const left = await h.one(`select count(*)::int as n from public.credit_purchases where stripe_event_id = 'evt_2'`);
      h.check("...and no record of the event is left behind (the retry will grant)", left.n === 0, JSON.stringify(left));

      // ---- a membership renewal
      await h.asService();
      const r1 = (await h.one(`select public.grant_subscription_credits_once('evt_3', $1, $2, null, 4, 'Membership renewed') as r`, [ann, group])).r;
      const r2 = (await h.one(`select public.grant_subscription_credits_once('evt_3', $1, $2, null, 4, 'Membership renewed') as r`, [ann, group])).r;
      await h.asSuper();
      h.check("a renewal grants once and a repeat grants nothing", r1 === true && r2 === false && (await bal()) === 9, `balance ${await bal()}`);
      h.check("...recording the grant once", (await h.one(`select count(*)::int as n from public.subscription_credit_grants where stripe_event_id = 'evt_3'`)).n === 1);

      // ---- who can call them
      await h.as(ann);
      await h.expectError("a signed-in person cannot run the grant", () => db.query(`select public.grant_purchase_once('evt_x', 'cs_x', $1, $2, null, 5, 1, 'x')`, [ann, group]), /permission denied|not authorized/i);
      await h.expectError("...or the renewal grant", () => db.query(`select public.grant_subscription_credits_once('evt_y', $1, $2, null, 5, 'x')`, [ann, group]), /permission denied|not authorized/i);
      await h.asSuper();
      const acl = await h.one(`select has_function_privilege('anon', 'public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text)', 'execute') as a, has_function_privilege('authenticated', 'public.grant_subscription_credits_once(text, uuid, uuid, uuid, integer, text)', 'execute') as b, has_function_privilege('service_role', 'public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text)', 'execute') as c`);
      h.check("only the server may run them", acl.a === false && acl.b === false && acl.c === true, JSON.stringify(acl));
    },
  },
};
