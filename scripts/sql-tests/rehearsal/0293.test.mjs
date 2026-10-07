// 0293: the refund logic moves to a server-only function; the signed-in refund_coach_credit accepts only the coach's own "this was wrong" flag, so a coach can
// no longer refund a plan they kept by claiming the generation failed ('auto_validator_failure' is only for the server).
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0293 refund: validator failure is server-only",
  migrations: ["0293"],
  phases: {
    async "0292"({ db, h }) {
      const coach = await h.user("R1 Coach");
      await h.org(coach);
      await h.asSuper();
      await db.query(`insert into public.coach_credits (coach_id, balance) values ($1, 10) on conflict (coach_id) do update set balance = 10`, [coach]);
      await h.asService();
      const charge = await tryQ(db, `select * from public.spend_ai_action($1, 'nutrition_plan', 3, 0)`, [coach]);
      await h.as(coach);
      const refund = await tryQ(db, `select public.refund_coach_credit('nutrition_plan', 'auto_validator_failure', 'baseline-r1', 'test') as ok`, []);
      await h.asSuper();
      const bal = await h.one(`select balance from public.coach_credits where coach_id = $1`, [coach]);
      h.check("baseline: before 0293 a signed-in coach can refund their own charge by claiming 'auto_validator_failure'",
        !charge.error && !refund.error && refund.rows?.[0]?.ok === true && Number(bal.balance) === 10, JSON.stringify({ charge, refund, bal }));
    },

    async "0293"({ db, h }) {
      const coach = await h.user("R2 Coach");
      const other = await h.user("R2 Other");
      await h.org(coach);
      await h.org(other);
      await h.asSuper();
      await db.query(`insert into public.coach_credits (coach_id, balance) values ($1, 10), ($2, 10) on conflict (coach_id) do update set balance = 10`, [coach, other]);
      const bal = async (c) => { await h.asSuper(); return Number((await h.one(`select balance from public.coach_credits where coach_id = $1`, [c])).balance); };
      const charge = async (c, action = "nutrition_plan") => { await h.asService(); await db.query(`select * from public.spend_ai_action($1, $2, 3, 0)`, [c, action]); };
      const flag = async (c, ref, action = "nutrition_plan") => { await h.as(c); return tryQ(db, `select public.refund_coach_credit($1, 'coach_flagged', $2, 'wrong') as ok`, [action, ref]); };

      // the signed-in function: only the coach's own flag
      await charge(coach);
      await h.as(coach);
      const auto = await tryQ(db, `select public.refund_coach_credit('nutrition_plan', 'auto_validator_failure', 'auto-r2', 'x') as ok`, []);
      h.check("a signed-in coach claiming 'auto_validator_failure' is refused", /Invalid trigger/.test(auto.error ?? ""), JSON.stringify(auto));
      h.check("...and nothing was refunded (the charge stands)", (await bal(coach)) === 7);
      await h.as(coach);
      const other2 = await tryQ(db, `select public.refund_coach_credit('nutrition_plan', 'anything', 'any-r2', 'x') as ok`, []);
      h.check("any other trigger name is refused too", /Invalid trigger/.test(other2.error ?? ""), JSON.stringify(other2));
      const f1 = await flag(coach, "flag-1");
      h.check("the coach's own 'This was wrong' still refunds the latest charge once", f1.rows?.[0]?.ok === true && (await bal(coach)) === 10, JSON.stringify(f1));
      const f2 = await flag(coach, "flag-2");
      h.check("a second flag with a new reference finds no unrefunded charge", f2.rows?.[0]?.ok === false && (await bal(coach)) === 10, JSON.stringify(f2));
      const f3 = await flag(coach, "flag-1");
      h.check("the same reference never refunds twice", f3.rows?.[0]?.ok === false && (await bal(coach)) === 10);
      await h.as(null);
      const out = await tryQ(db, `select public.refund_coach_credit('nutrition_plan', 'coach_flagged', 'out-r2', 'x') as ok`, []);
      h.check("a signed-out caller still cannot refund", /Not signed in|permission denied/.test(out.error ?? ""), JSON.stringify(out));
      await charge(coach, "program_generation");
      const wrongAction = await flag(coach, "flag-w", "nutrition_plan");
      h.check("a program charge still cannot be refunded as a meal plan (one action, one charge)", wrongAction.rows?.[0]?.ok === false && (await bal(coach)) === 7);
      const badAction = await flag(coach, "flag-b", "ci_overview");
      h.check("an unknown action is still refused", /Invalid action/.test(badAction.error ?? ""), JSON.stringify(badAction));
      await flag(coach, "flag-p", "program_generation");
      h.check("...and refunds as itself", (await bal(coach)) === 10);

      // the server-only function
      await charge(coach);
      await h.as(coach);
      const direct = await tryQ(db, `select public.refund_coach_credit_for($1, 'nutrition_plan', 'auto_validator_failure', 'direct-r2', 'x') as ok`, [coach]);
      h.check("a signed-in coach cannot call the server-only refund function at all", /permission denied/i.test(direct.error ?? ""), JSON.stringify(direct));
      await h.as(null);
      const anon = await tryQ(db, `select public.refund_coach_credit_for($1, 'nutrition_plan', 'auto_validator_failure', 'anon-r2', 'x') as ok`, [coach]);
      h.check("the public cannot call it either", /permission denied/i.test(anon.error ?? ""), JSON.stringify(anon));
      await h.asService();
      const svc = await tryQ(db, `select public.refund_coach_credit_for($1, 'nutrition_plan', 'auto_validator_failure', 'svc-r2', 'validator') as ok`, [coach]);
      h.check("the server (service role) can refund a named coach's latest charge for a validator failure", svc.rows?.[0]?.ok === true && (await bal(coach)) === 10, JSON.stringify(svc));
      await h.asService();
      const svc2 = await tryQ(db, `select public.refund_coach_credit_for($1, 'nutrition_plan', 'auto_validator_failure', 'svc-r2', 'again') as ok`, [coach]);
      h.check("the same reference never refunds twice for the server either", svc2.rows?.[0]?.ok === false && (await bal(coach)) === 10);
      const svc3 = await tryQ(db, `select public.refund_coach_credit_for($1, 'nutrition_plan', 'auto_validator_failure', 'svc-none', 'x') as ok`, [other]);
      h.check("the server cannot refund someone with nothing charged (no minting)", svc3.rows?.[0]?.ok === false && (await bal(other)) === 10);
      const svcBad = await tryQ(db, `select public.refund_coach_credit_for(null, 'nutrition_plan', 'auto_validator_failure', 'svc-null', 'x') as ok`, []);
      h.check("the server function refuses a missing coach", /Not signed in/.test(svcBad.error ?? ""), JSON.stringify(svcBad));

      // the automatic refund checks its evidence INSIDE the function, under the lock on the charge it refunds
      const third = await h.user("R3 Coach");
      await h.org(third);
      await h.asSuper();
      await db.query(`insert into public.coach_credits (coach_id, balance) values ($1, 10) on conflict (coach_id) do update set balance = 10`, [third]);
      const ids = async () => { await h.asSuper(); return (await h.rows(`select id, refunded_at is not null as refunded from public.ai_charges where coach_id = $1 order by created_at desc`, [third])); };
      const autoFor = async (ref, chargeId = null, action = "nutrition_plan") => { await h.asService(); return tryQ(db, `select public.refund_coach_credit_for($1, $2, 'auto_validator_failure', $3, 'v', $4) as ok`, [third, action, ref, chargeId]); };
      const delivered = async (when) => { await h.asSuper(); await db.query(`insert into public.ai_usage_log (user_id, coach_id, feature, status, created_at) values ($1, $1, 'meal_plan_slot_delivered', 'ok', ${when})`, [third]); };

      // A = a plan the coach kept (made 2 hours ago, the AI delivered then); B = a failed generation made now
      await charge(third);
      await h.asSuper();
      await db.query(`update public.ai_charges set created_at = now() - interval '2 hours' where coach_id = $1`, [third]);
      await delivered(`now() - interval '2 hours'`);
      await charge(third);
      const both = await ids();
      const B = both[0].id;
      const A = both[1].id;
      const bAfterBoth = await bal(third);
      h.check("two charges are in place (A kept, B failed) and the balance reflects both", both.length === 2 && bAfterBoth === 4, JSON.stringify({ both, bAfterBoth }));

      const r1 = await autoFor("x1", B);
      const r2 = await autoFor("x2", B);
      const afterRace = await ids();
      h.check("two requests at once for the failed charge B: only one refunds, the second finds it already refunded", r1.rows?.[0]?.ok === true && r2.rows?.[0]?.ok === false, JSON.stringify({ r1, r2 }));
      h.check("...and the kept plan's charge A was NOT refunded by the second request", afterRace.find((c) => c.id === A)?.refunded === false && (await bal(third)) === 7);
      const rA = await autoFor("x3", A);
      h.check("naming the kept plan's charge A for an automatic refund is refused: the AI delivered for it", rA.rows?.[0]?.ok === false && (await ids()).find((c) => c.id === A)?.refunded === false, JSON.stringify(rA));
      const rNone = await autoFor("x4", null);
      h.check("an automatic refund without a charge id lands on the latest unrefunded charge (A) and is refused for the same reason", rNone.rows?.[0]?.ok === false && (await ids()).find((c) => c.id === A)?.refunded === false, JSON.stringify(rNone));
      const rProg = await autoFor("x5", null, "program_generation");
      h.check("there is no automatic refund for a program generation", /No automatic refund exists/.test(rProg.error ?? ""), JSON.stringify(rProg));

      // look-back: a delivery 20 minutes BEFORE the charge still counts (generate first, then press the charging button); one 40 minutes before does not
      await charge(third);
      const C = (await ids())[0].id;
      await delivered(`now() - interval '20 minutes'`);
      const rLook = await autoFor("x6", C);
      h.check("a delivery 20 minutes before the charge blocks the automatic refund (generate-then-charge ordering)", rLook.rows?.[0]?.ok === false, JSON.stringify(rLook));
      await h.asSuper();
      await db.query(`delete from public.ai_usage_log where user_id = $1 and feature = 'meal_plan_slot_delivered' and created_at > now() - interval '1 hour'`, [third]);
      await delivered(`now() - interval '40 minutes'`);
      const rOld = await autoFor("x7", C);
      h.check("a delivery 40 minutes before the charge does not (the plan was not delivered for THIS charge)", rOld.rows?.[0]?.ok === true, JSON.stringify(rOld));
      await h.asSuper();
      await db.query(`delete from public.ai_usage_log where user_id = $1`, [third]);

      // the permissions of the signed-in function are exactly what they were
      await h.asSuper();
      const acl = await h.one(`select
        has_function_privilege('authenticated', 'public.refund_coach_credit(text, text, text, text)', 'execute') as auth_x,
        has_function_privilege('service_role', 'public.refund_coach_credit(text, text, text, text)', 'execute') as svc_x,
        has_function_privilege('anon', 'public.refund_coach_credit(text, text, text, text)', 'execute') as anon_x,
        has_function_privilege('authenticated', 'public.refund_coach_credit_for(uuid, text, text, text, text, uuid)', 'execute') as for_auth,
        has_function_privilege('anon', 'public.refund_coach_credit_for(uuid, text, text, text, text, uuid)', 'execute') as for_anon,
        has_function_privilege('service_role', 'public.refund_coach_credit_for(uuid, text, text, text, text, uuid)', 'execute') as for_svc`);
      h.check("refund_coach_credit keeps its grants (signed-in and server, not the public)", acl.auth_x && acl.svc_x && !acl.anon_x, JSON.stringify(acl));
      h.check("refund_coach_credit_for is the server's alone", !acl.for_auth && !acl.for_anon && acl.for_svc, JSON.stringify(acl));
    },
  },
};
