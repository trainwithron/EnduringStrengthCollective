// 0424: the first person a program is assigned to gets the ORIGINAL (Ron: "first person gets the original"), later people get a copy. An active program in a group with no clients is now attached too;
// a program someone already has a copy of, and a template with slots, are always copied. Every 0337 rule stays (other organization, an AI draft, a team's shared program, history).
export default {
  name: "0424 first assignee gets the original",
  migrations: ["0424"],
  phases: {
    async "0424"({ db, h }) {
      const coach = await h.user("FO Coach");
      const amy = await h.user("FO Amy");
      const bob = await h.user("FO Bob");
      const cal = await h.user("FO Cal");
      const org = await h.org(coach);
      const otherOrg = await h.org(coach);
      const library = await h.group(org, coach, "team", "FO library (no clients)");
      const team = await h.group(org, coach, "team", "FO team");
      const amySolo = await h.group(org, coach, "one_on_one", "FO Amy");
      const bobSolo = await h.group(org, coach, "one_on_one", "FO Bob");
      const calOther = await h.group(otherOrg, coach, "one_on_one", "FO Cal elsewhere");
      await h.member(amySolo, amy);
      await h.member(bobSolo, bob);
      await h.member(calOther, cal);
      await h.member(team, cal);

      await h.asSuper();
      async function build(group, name, opts = {}) {
        const prog = (await db.query(`insert into public.programs (group_id, name, created_by, is_active, ai_draft) values ($1, $2, $3, $4, $5) returning id`, [group, name, coach, opts.active ?? true, opts.draft ?? false])).rows[0].id;
        const w = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 1', 1) returning id`, [prog, group])).rows[0].id;
        await db.query(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order, tracked_fields, is_slot) values ($1, $2, 'Squat', 0, array['reps'], $3)`, [w, group, opts.slot ?? false]);
        return prog;
      }
      const assign = async (prog, dest, who, name) => {
        await h.as(coach);
        const r = await h.one(`select * from public.assign_program_to_client($1, $2, $3, $4, null)`, [prog, dest, who, name]);
        await h.asSuper();
        return r;
      };
      const row = (id) => h.one(`select group_id, athlete_id, is_active, source_program_id from public.programs where id = $1`, [id]);

      // 1. an ACTIVE program in a group with no clients (the coach's library): the first person gets the original
      const p1 = await build(library, "FO Strength", { active: true });
      const first = await assign(p1, amySolo, amy, "Amy");
      h.check("the first person gets the original (an active program in a group with no clients)", first.was_attached === true && first.assigned_program_id === p1, JSON.stringify(first));
      const p1Now = await row(p1);
      h.check("it is now Amy's, in her space, active", p1Now.group_id === amySolo && p1Now.athlete_id === amy && p1Now.is_active === true, JSON.stringify(p1Now));

      // 2. the next person gets a copy of it
      const second = await assign(p1, bobSolo, bob, "Bob");
      h.check("the next person gets a copy", second.was_attached === false && second.assigned_program_id !== p1, JSON.stringify(second));
      h.check("Amy keeps the original", (await row(p1)).athlete_id === amy);

      // 3. a program someone already has a copy of stays the template: copied
      const p2 = await build(library, "FO Hypertrophy", { active: true });
      await db.query(`insert into public.programs (group_id, name, created_by, athlete_id, is_active, source_program_id) values ($1, 'FO Hypertrophy (Bob)', $2, $3, true, $4)`, [bobSolo, coach, bob, p2]);
      const p2r = await assign(p2, amySolo, amy, "Amy");
      h.check("a program someone already has a copy of is copied, not handed over", p2r.was_attached === false, JSON.stringify(p2r));
      h.check("it stays in the library with no client", (await row(p2)).athlete_id === null && (await row(p2)).group_id === library);

      // 4. a template with a slot is never handed over (it is not attached; the copy step refuses a slot template until its exercises are chosen per client, as before)
      const p3 = await build(library, "FO Slot template", { active: true, slot: true });
      await h.as(coach);
      const p3r = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Amy', null)`, [p3, amySolo, amy]).catch((e) => ({ error: String(e.message) }));
      await h.asSuper();
      h.check("a template with slots is never handed over to the first person", p3r.was_attached !== true && (await row(p3)).athlete_id === null && (await row(p3)).group_id === library, JSON.stringify(p3r));

      // 5. unchanged from 0337: a team's active program (the group has clients) is copied; the team keeps it
      const p4 = await build(team, "FO Team plan", { active: true });
      const p4r = await assign(p4, amySolo, amy, "Amy");
      h.check("a team's active program is still copied (the group has clients)", p4r.was_attached === false && (await row(p4)).group_id === team, JSON.stringify(p4r));

      // 6. unchanged: an inactive program in a group with clients is attached (0335/0337)
      const p5 = await build(team, "FO Inactive in team", { active: false });
      const p5r = await assign(p5, bobSolo, bob, "Bob");
      h.check("an inactive program is still attached", p5r.was_attached === true && p5r.assigned_program_id === p5, JSON.stringify(p5r));

      // 7. unchanged: into another organization it is copied
      const p6 = await build(library, "FO Cross", { active: true });
      const p6r = await assign(p6, calOther, cal, "Cal");
      h.check("into another organization it is still copied", p6r.was_attached === false && (await row(p6)).group_id === library, JSON.stringify(p6r));

      // 8. unchanged: an AI draft is never handed over
      const p7 = await build(library, "FO Draft", { active: false, draft: true });
      await h.as(coach);
      const p7r = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'Amy', null)`, [p7, amySolo, amy]).catch((e) => ({ error: String(e.message) }));
      await h.asSuper();
      h.check("an AI draft is never attached", p7r.was_attached !== true, JSON.stringify(p7r));
    },
  },
};
