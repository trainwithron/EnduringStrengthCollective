// 0346: a coach using the app as their own client. Nutrition phase plans and transformation cards work for a coach in their own group, and "Assign to Myself" attaches the program (it becomes the
// coach's own, no copy). Nothing is loosened for anyone else: a coach cannot assign to a person who is not an athlete of the group, and a stranger cannot assign to themselves.
export default {
  name: "0346 a coach can use the app as their own client",
  migrations: ["0346"],
  phases: {
    async "0346"({ db, h }) {
      const owner = await h.user("CO Owner");
      const coach = await h.user("CO Coach");
      const stranger = await h.user("CO Stranger");
      const client = await h.user("CO Client");
      const org = await h.org(owner);
      await h.orgMember(org, coach, "coach");
      const team = await h.group(org, coach, "team", "CO team");
      await h.member(team, client);

      await h.asSuper();
      await db.query("alter table public.programs disable trigger programs_guard_one_on_one");
      const draft = async (name) =>
        (await db.query(`insert into public.programs (group_id, name, created_by, athlete_id, is_active) values ($1, $2, $3, null, false) returning id`, [team, name, coach])).rows[0].id;
      const pAttach = await draft("CO attach me");
      const pOther = await draft("CO other");
      await db.query("alter table public.programs enable trigger programs_guard_one_on_one");

      // ---- the coach, as their own client --------------------------------------------------
      await h.as(coach);
      await db.query(`insert into public.client_phase_plans (athlete_id, group_id, phase) values ($1, $2, 'maintenance')`, [coach, team]);
      h.check("the coach's own phase plan was saved", (await db.query(`select count(*)::int as n from public.client_phase_plans where athlete_id = $1`, [coach])).rows[0].n === 1);

      await db.query(`insert into public.transformation_cards (athlete_id, group_id, starting_weight, current_weight, window_start_date, window_end_date) values ($1, $2, 200, 190, current_date - 30, current_date)`, [coach, team]);
      h.check("the coach can make their own transformation card", (await db.query(`select count(*)::int as n from public.transformation_cards where athlete_id = $1`, [coach])).rows[0].n === 1);

      const mine = (await db.query(`select * from public.assign_program_to_client($1, $2, $3, 'CO coach', null)`, [pAttach, team, coach])).rows[0];
      h.check("Assign to Myself attaches the program (no copy)", mine.was_attached === true && mine.assigned_program_id === pAttach);
      h.check("...and the program is now the coach's own", (await db.query(`select athlete_id from public.programs where id = $1`, [pAttach])).rows[0].athlete_id === coach);

      // ---- nobody else gains anything -----------------------------------------------------------------
      await h.as(coach);
      await h.expectError("assigning to a person who is not an athlete of the group", async () => {
        await db.query(`select * from public.assign_program_to_client($1, $2, $3, 'x', null)`, [pOther, team, stranger]);
      }, /not in that group/);

      await h.as(stranger);
      await h.expectError("a stranger assigning to themselves", async () => {
        await db.query(`select * from public.assign_program_to_client($1, $2, $3, 'x', null)`, [pOther, team, stranger]);
      }, /not in that group|Source program not found|not allowed|permission/i);
      await h.expectError("a stranger making a phase plan", async () => {
        await db.query(`insert into public.client_phase_plans (athlete_id, group_id, phase) values ($1, $2, 'fat_loss')`, [stranger, team]);
      }, /row-level security|violates|not a member/i);
    },
  },
};
