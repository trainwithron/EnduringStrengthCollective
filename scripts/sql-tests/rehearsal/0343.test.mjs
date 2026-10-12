// 0343: a coach's credit pack or Lift Off grant is recorded and added in one step; a failed add leaves no record behind; a repeat changes nothing; only the server can run it.
export default {
  name: "0343 coach credit grants are recorded and added in one step",
  migrations: ["0343"],
  phases: {
    async "0343"({ db, h }) {
      const coach = await h.user("AU Coach");
      await h.org(coach);

      await h.asSuper();
      const balance = async () => (await db.query(`select balance from public.coach_credits where coach_id = $1`, [coach])).rows[0]?.balance ?? 0;
      // the grants are for the server only: they run as the service role
      const run = async (sql, params) => {
        await h.asService();
        try {
          return (await db.query(sql, params)).rows[0];
        } finally {
          await h.asSuper();
        }
      };

      const first = await run(`select public.grant_coach_credit_pack_once('evt_1', 'cs_1', $1, 50, 500) as v`, [coach]);
      h.check("the first delivery grants the credits and says so", first.v === true && (await balance()) === 50);
      const again = await run(`select public.grant_coach_credit_pack_once('evt_1', 'cs_1', $1, 50, 500) as v`, [coach]);
      h.check("a repeat of the same event grants nothing more and says false", again.v === false && (await balance()) === 50);
      const rec = await run(`select count(*)::int as n from public.coach_credit_purchases where stripe_event_id = 'evt_1'`);
      h.check("...and records the payment once", rec.n === 1);

      // A grant that cannot be made leaves no record behind (so the retry grants).
      await h.expectError("a grant for a coach that does not exist fails as a whole", () => run(`select public.grant_coach_credit_pack_once('evt_2', 'cs_2', $1, 10, 100)`, [h.uuid(999)]), /./);
      const leftover = await run(`select count(*)::int as n from public.coach_credit_purchases where stripe_event_id = 'evt_2'`);
      h.check("...and no record of the event is left behind (the retry will grant)", leftover.n === 0);

      const lift = await run(`select public.grant_lift_off_credits_once('evt_3', $1, 25) as v`, [coach]);
      h.check("a Lift Off month grants once", lift.v === true && (await balance()) === 75);
      const liftAgain = await run(`select public.grant_lift_off_credits_once('evt_3', $1, 25) as v`, [coach]);
      h.check("...and a repeat grants nothing", liftAgain.v === false && (await balance()) === 75);

      await h.as(coach);
      await h.expectError("a signed-in person cannot run the pack grant", () => db.query(`select public.grant_coach_credit_pack_once('evt_9', 'cs_9', $1, 1000, 1)`, [coach]), /permission denied/i);
      await h.expectError("...or the Lift Off grant", () => db.query(`select public.grant_lift_off_credits_once('evt_9', $1, 1000)`, [coach]), /permission denied/i);
    },
  },
};
