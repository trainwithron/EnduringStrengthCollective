// 0245 (live): an AI refund must consume one real, recorded charge from the last 24 hours, once, and hand back what that charge took: no minting.
// 0250: the allowance and the monthly ceiling scale with coach_ai_multiplier (free beta orgs 0.3, explicit scale, client-count tiers), and the
// refund rules still hold on the replacement spend_ai_action.
async function refundRules({ db, h }, label) {
  const coach = await h.user(`AI Coach ${label}`);
  const other = await h.user(`AI Other ${label}`);
  const org = await h.org(coach);
  await h.org(other);
  await h.asSuper();
  await db.query(`insert into public.coach_credits (coach_id, balance) values ($1, 10), ($2, 10) on conflict (coach_id) do update set balance = 10`, [coach, other]);
  const bal = async (c = coach) => { await h.asSuper(); return (await h.one(`select balance, program_used from public.coach_credits where coach_id = $1`, [c])); };
  const spend = async (c, action, credits, allowance) => { await h.as(c); return (await h.rows(`select * from public.spend_ai_action($1, $2, $3, $4)`, [c, action, credits, allowance]))[0]; };
  const refund = async (c, action, ref, trigger = "coach_flagged") => { await h.as(c); return (await h.one(`select public.refund_coach_credit($1, $2, $3, 'test') as ok`, [action, trigger, ref])).ok; };

  // no charge, no refund, however many times it is asked
  let minted = 0;
  for (let i = 0; i < 5; i++) if (await refund(coach, "program_generation", `mint-${label}-${i}`)) minted++;
  h.check(`[${label}] refund with nothing charged returns false every time and mints nothing`, minted === 0 && (await bal()).balance === 10);

  // credits path
  const s = await spend(coach, "program_generation", 3, 0);
  h.check(`[${label}] spending without allowance takes credits and records a charge`, s.spent && s.source === "credits" && (await bal()).balance === 7);
  h.check(`[${label}] one refund gives back exactly what the charge took`, (await refund(coach, "program_generation", `r1-${label}`)) === true && (await bal()).balance === 10);
  h.check(`[${label}] a second refund with a new reference finds no unrefunded charge`, (await refund(coach, "program_generation", `r2-${label}`)) === false && (await bal()).balance === 10);
  h.check(`[${label}] the same reference never refunds twice`, (await refund(coach, "program_generation", `r1-${label}`)) === false && (await bal()).balance === 10);

  // a charge of one action cannot be refunded as another
  await spend(coach, "nutrition_plan", 3, 0);
  h.check(`[${label}] a meal-plan charge cannot be refunded as a program generation`, (await refund(coach, "program_generation", `x-${label}`)) === false && (await bal()).balance === 7);
  h.check(`[${label}] ...but can be refunded as itself`, (await refund(coach, "nutrition_plan", `y-${label}`)) === true && (await bal()).balance === 10);

  // old charges are not refundable
  await spend(coach, "program_generation", 3, 0);
  await h.asSuper();
  await db.query(`update public.ai_charges set created_at = now() - interval '25 hours' where coach_id = $1 and refunded_at is null`, [coach]);
  h.check(`[${label}] a charge older than 24 hours cannot be refunded`, (await refund(coach, "program_generation", `old-${label}`)) === false && (await bal()).balance === 7);
  await db.query(`update public.coach_credits set balance = 10 where coach_id = $1`, [coach]);

  // other coaches' charges are theirs
  await spend(other, "program_generation", 3, 0);
  h.check(`[${label}] a coach cannot refund against another coach's charge`, (await refund(coach, "program_generation", `steal-${label}`)) === false && (await bal(other)).balance === 7);

  // allowance path restores the slot
  await h.asSuper();
  await db.query(`update public.coach_credits set program_used = 0, allowance_period = date_trunc('month', now() at time zone 'utc')::date where coach_id = $1`, [coach]);
  const a = await spend(coach, "program_generation", 3, 30);
  const used1 = (await bal()).program_used;
  h.check(`[${label}] a generation covered by the included allowance records source 'allowance' and uses one slot`, a.spent && a.source === "allowance" && used1 === 1, JSON.stringify(a));
  await refund(coach, "program_generation", `slot-${label}`);
  h.check(`[${label}] refunding it restores the slot, not credits`, (await bal()).program_used === 0 && (await bal()).balance === 10);

  // validation
  await h.as(coach);
  await h.expectError(`[${label}] an unknown trigger is refused`, () => db.query(`select public.refund_coach_credit('program_generation', 'because', 'z-${label}', null)`), /Invalid trigger/);
  await h.expectError(`[${label}] an unknown action is refused`, () => db.query(`select public.refund_coach_credit('mystery', 'coach_flagged', 'z2-${label}', null)`), /Invalid action/);
  await h.expectError(`[${label}] spending as someone else is refused`, () => db.query(`select * from public.spend_ai_action($1, 'program_generation', 3, 0)`, [other]), /Not authorized/);
  await h.as(null);
  await h.expectError(`[${label}] a signed-out caller cannot refund`, () => db.query(`select public.refund_coach_credit('program_generation', 'coach_flagged', 'q-${label}', null)`), /permission denied|Not signed in/i);
}

export default {
  name: "0245 refunds tied to charges; 0250 AI allowance scaling",
  migrations: ["0245", "0250"],
  phases: {
    async live(ctx) { await refundRules(ctx, "live 0245"); },

    async "0250"(ctx) {
      const { db, h } = ctx;
      await refundRules(ctx, "after 0250");

      // ---- the multiplier
      const multiplier = async (c) => { await h.asSuper(); return Number((await h.one(`select public.coach_ai_multiplier($1) as m`, [c])).m); };
      const mkCoach = async (name, athletes = 0) => {
        const c = await h.user(name);
        const org = await h.org(c);
        const g = await h.group(org, c, "team", name + " group");
        for (let i = 0; i < athletes; i++) await h.member(g, await h.user(`${name} athlete ${i}`));
        return { c, org };
      };
      const noClients = await mkCoach("Mult none", 0);
      h.check("0250: a coach with no clients gets the quarter-step floor (0.25), so they can still build programs", (await multiplier(noClients.c)) === 0.25);
      const ten = await mkCoach("Mult ten", 10);
      h.check("0250: under 25 clients is a prorated share of one step (10 clients = 0.4)", (await multiplier(ten.c)) === 0.4);
      const fifty = await mkCoach("Mult fifty", 50);
      h.check("0250: 25 to 100 clients is one full step", (await multiplier(fifty.c)) === 1);
      const exempt = await mkCoach("Mult exempt", 10);
      await h.asSuper();
      await db.query(`insert into public.organization_billing (organization_id, billing_exempt) values ($1, true) on conflict (organization_id) do update set billing_exempt = true`, [exempt.org]);
      h.check("0250: a free-access (billing exempt) org with no scale set gets 0.3", (await multiplier(exempt.c)) === 0.3);
      await db.query(`update public.organization_billing set ai_allowance_scale = 0.5 where organization_id = $1`, [exempt.org]);
      h.check("0250: an explicit scale on the org wins", (await multiplier(exempt.c)) === 0.5);
      await db.query(`insert into public.organization_billing (organization_id, ai_allowance_scale) values ($1, 1.5) on conflict (organization_id) do update set ai_allowance_scale = 1.5`, [noClients.org]);
      h.check("...even above 1 for a paying org with an explicit scale", (await multiplier(noClients.c)) === 1.5);
      await h.expectError("0250: a negative scale is refused", () => db.query(`update public.organization_billing set ai_allowance_scale = -1 where organization_id = $1`, [noClients.org]), /check constraint/i);

      // ---- spend_ai_action uses it: exempt coach at 0.5 with a per-step allowance of 4 -> 2 included, then credits
      await db.query(`insert into public.coach_credits (coach_id, balance) values ($1, 10) on conflict (coach_id) do update set balance = 10, program_used = 0, allowance_period = date_trunc('month', now() at time zone 'utc')::date`, [exempt.c]);
      await h.as(exempt.c);
      const sources = [];
      for (let i = 0; i < 3; i++) sources.push((await h.rows(`select * from public.spend_ai_action($1, 'program_generation', 3, 4)`, [exempt.c]))[0].source);
      h.check("0250: the included allowance is scaled (4 x 0.5 = 2 included, the third generation takes credits)", sources.join() === "allowance,allowance,credits", sources.join());

      // ---- reserve_ai_call: monthly ceiling counts every logged call, successful or not; burst limit; service role only
      await h.asService();
      const calls = [];
      for (let i = 0; i < 4; i++) {
        const r = (await h.rows(`select * from public.reserve_ai_call($1, $2, 'program_generation', true, 100, array['program_generation'], 10)`, [exempt.c, exempt.c]))[0];
        calls.push(r.denied_reason ?? "ok");
      }
      h.check("0250: a monthly ceiling of 10 per step scaled by 0.5 allows the first four logged calls", calls.join() === "ok,ok,ok,ok", calls.join());
      const more = [];
      for (let i = 0; i < 2; i++) more.push((await h.rows(`select * from public.reserve_ai_call($1, $2, 'program_generation', true, 100, array['program_generation'], 10)`, [exempt.c, exempt.c]))[0].denied_reason ?? "ok");
      h.check("0250: the ceiling is 5 logged calls (every call counts, successful or not): the fifth passes, the sixth is refused with monthly_ceiling", more.join() === "ok,monthly_ceiling", more.join());
      const burst = [];
      const burstUser = await h.user("Burst user");
      await h.asService();
      for (let i = 0; i < 3; i++) burst.push((await h.rows(`select * from public.reserve_ai_call($1, null, 'ci_chat', true, 2, array['ci_chat'], null)`, [burstUser]))[0].denied_reason ?? "ok");
      h.check("0250: the per-minute burst limit still applies (2 per minute, third refused)", burst.join() === "ok,ok,burst", burst.join());
      await h.as(exempt.c);
      await h.expectError("0250: only the service role can reserve an AI call", () => db.query(`select * from public.reserve_ai_call($1, $1, 'program_generation', true, 100, array['program_generation'], 10)`, [exempt.c]), /Not authorized/);
    },
  },
};
