// 0244: standing macro targets become a dated history; a coach can only write targets for people in the group they coach, and a row planted
// before the migration by another coach is cleaned up.
export default {
  name: "0244 macro target history and row security",
  migrations: ["0244", "0239"],
  phases: {
    // Before 0244 (live has 0239): show the weakness the migration fixes, and leave a planted row for it to clean up.
    async live({ db, h, state }) {
      const coachA = await h.user("Macro Coach A");
      const coachB = await h.user("Macro Coach B");
      const orgA = await h.org(coachA);
      const orgB = await h.org(coachB);
      const ga = await h.group(orgA, coachA, "team", "GA");
      const gb = await h.group(orgB, coachB, "team", "GB");
      const x = await h.user("Client X");
      const y = await h.user("Client Y");
      await h.member(ga, x);
      await h.member(gb, y);
      Object.assign(state, { coachA, coachB, ga, gb, x, y });
      await h.as(coachA);
      await db.query(`insert into public.client_macro_targets (athlete_id, group_id, calories, protein_g, updated_by) values ($1, $2, 2400, 180, $3)`, [x, ga, coachA]);
      // The old table's key is the athlete alone, so a row planted for X by another coach also blocks X's real coach.
      await h.asSuper();
      await db.query(`delete from public.client_macro_targets where athlete_id = $1`, [x]);
      await h.as(coachB);
      let planted = true;
      try { await db.query(`insert into public.client_macro_targets (athlete_id, group_id, calories, updated_by) values ($1, $2, 1, $3)`, [x, gb, coachB]); } catch { planted = false; }
      h.check("baseline: on the live schema another coach can plant a standing target naming X and their own group (the hole 0244 closes)", planted);
      await h.as(coachA);
      let blocked = false;
      try { await db.query(`insert into public.client_macro_targets (athlete_id, group_id, calories, updated_by) values ($1, $2, 2400, $3) on conflict (athlete_id) do update set calories = excluded.calories`, [x, ga, coachA]); } catch { blocked = true; }
      h.check("baseline: and X's real coach is then refused when saving X's target", blocked);
      await h.asSuper();
      // the real, legitimate target for another athlete (carried over by the migration)
      const w = await h.user("Client W");
      await h.member(ga, w);
      await db.query(`insert into public.client_macro_targets (athlete_id, group_id, calories, protein_g, carbs_g, fat_g, updated_by, updated_at) values ($1, $2, 2600, 190, 280, 70, $3, '2026-10-01T12:00:00Z')`, [w, ga, coachA]);
      state.w = w;
    },

    async "0244"({ db, h, state }) {
      const { coachA, coachB, ga, gb, x, y, w } = state;
      await h.asSuper();
      const carried = await h.one(`select calories, protein_g, effective_from::text as d from public.client_macro_target_history where athlete_id = $1 and group_id = $2`, [w, ga]);
      h.check("an existing standing target is carried over as the first history row, effective the day it was saved", carried && carried.calories === 2600 && carried.protein_g === 190 && carried.d === "2026-10-01", JSON.stringify(carried));
      h.check("the row planted by another coach is removed from the old table", (await h.one(`select count(*)::int as n from public.client_macro_targets where athlete_id = $1 and group_id = $2`, [x, gb])).n === 0);

      await h.as(coachB);
      await h.expectError("another coach can no longer plant a target in the old table for someone outside their group", () => db.query(`insert into public.client_macro_targets (athlete_id, group_id, calories, updated_by) values ($1, $2, 1, $3)`, [x, gb, coachB]), /row-level security/i);
      await h.expectError("...nor in the history table", () => db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, created_by) values ($1, $2, '2026-10-02', 1, $3)`, [x, gb, coachB]), /row-level security/i);
      await h.expectError("a coach cannot write history for an athlete in someone else's group", () => db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, created_by) values ($1, $2, '2026-10-02', 1, $3)`, [x, ga, coachB]), /row-level security/i);

      await h.as(coachA);
      await db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, protein_g, created_by) values ($1, $2, '2026-10-05', 2400, 180, $3)`, [x, ga, coachA]);
      await db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, protein_g, created_by) values ($1, $2, '2026-10-08', 2400, 200, $3)`, [x, ga, coachA]);
      const hist = await h.rows(`select effective_from::text as d, protein_g from public.client_macro_target_history where athlete_id = $1 and group_id = $2 order by effective_from`, [x, ga]);
      h.check("the real coach can add dated history rows, and earlier days keep their own target (Wednesday's edit does not rewrite Monday)", hist.length === 2 && hist[0].protein_g === 180 && hist[1].protein_g === 200);
      await db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g, created_by) values ($1, $2, '2026-10-12', null, null, null, null, $3)`, [x, ga, coachA]);
      h.check("a row with every number null (no standing target from that date) is allowed", true);
      await h.expectError("a negative or absurd number is refused", () => db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, created_by) values ($1, $2, '2026-10-13', 99999, $3)`, [x, ga, coachA]), /check constraint/i);
      await h.expectError("two rows for the same day are refused (the key is athlete, group, date)", () => db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, created_by) values ($1, $2, '2026-10-05', 1, $3)`, [x, ga, coachA]), /duplicate key/i);

      await h.as(x);
      h.check("the athlete reads their own history", (await h.rows(`select 1 from public.client_macro_target_history where athlete_id = $1`, [x])).length === 3);
      const own = await h.rows(`update public.client_macro_target_history set calories = 9000 where athlete_id = $1 returning 1`, [x]).catch(() => "denied");
      await h.asSuper();
      h.check("the athlete cannot change their own targets", (own === "denied" || own.length === 0) && (await h.one(`select count(*)::int as n from public.client_macro_target_history where athlete_id = $1 and calories = 9000`, [x])).n === 0);
      await h.as(y);
      h.check("another athlete cannot read this athlete's history", (await h.rows(`select 1 from public.client_macro_target_history where athlete_id = $1`, [x])).length === 0);
    },
  },
};
