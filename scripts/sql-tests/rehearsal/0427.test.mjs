// 0427 (SPEED migration B): the read policies on the ten busiest tables ask "is a member / a coach / an owner or admin of this group" from three sets once per query instead of once per row.
// (The undo is checked too: it must put every policy text back exactly.)
// Proof here: an organization with an owner, a coach, an ordinary client and a client kept PRIVATE from the organization. Before 0427 (after 0426) each person's visible rows are counted in all ten
// tables through real row security; after 0427 the counts are the same, and the private client is still hidden from the owner and still visible to the coach and to themselves.
const TABLES = ["programs", "workouts", "group_workout_exercises", "group_workout_exercise_sets", "athlete_sessions", "session_exercises", "set_logs", "group_memberships", "groups", "workout_logs"];
const people = {};
let before = null;
let helperPolicies = 0;
let textsBefore = "";
const policyTexts = (h) => h.one(`select string_agg(tablename || '|' || policyname || '|' || qual, chr(10) order by tablename, policyname) as s from pg_policies where schemaname = 'public' and cmd = 'SELECT' and tablename = any($1) and policyname <> 'org_wall_header'`, [TABLES]).then((r) => r.s);

async function counts(db, h) {
  const out = {};
  for (const [label, id] of Object.entries(people)) {
    await h.as(id);
    for (const t of TABLES) out[`${label}:${t}`] = (await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n;
    out[`${label}:private program`] = (await db.query(`select count(*)::int as n from public.programs where name = 'MB private program'`)).rows[0].n;
    await h.asSuper();
  }
  return out;
}

export default {
  name: "0427 member checks as sets",
  migrations: ["0426", "0427"],
  phases: {
    async "0426"({ db, h }) {
      people.owner = await h.user("MB Owner");
      people.coach = await h.user("MB Coach");
      people.client = await h.user("MB Client");
      people.privateClient = await h.user("MB Private Client");
      const org = await h.org(people.owner);
      await h.orgMember(org, people.coach, "coach");
      const team = await h.group(org, people.coach, "team", "MB team");
      const privateSpace = await h.group(org, people.coach, "one_on_one", "MB private space");
      await h.member(team, people.client);
      await h.member(privateSpace, people.privateClient);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [privateSpace, people.privateClient]);
      const build = async (g, name, athlete) => {
        const p = (await db.query(`insert into public.programs (group_id, name, created_by, athlete_id, is_active) values ($1, $2, $3, $4, true) returning id`, [g, name, people.coach, athlete])).rows[0].id;
        const w = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index, athlete_id) values ($1, $2, 'Day 1', 1, $3) returning id`, [p, g, athlete])).rows[0].id;
        const e = (await db.query(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order, tracked_fields, athlete_id) values ($1, $2, 'Squat', 0, array['reps'], $3) returning id`, [w, g, athlete])).rows[0].id;
        await db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps) values ($1, 0, '5')`, [e]);
      };
      await build(team, "MB team program", null);
      await build(team, "MB client program", people.client);
      await build(privateSpace, "MB private program", people.privateClient);
      before = await counts(db, h);
      textsBefore = await policyTexts(h);
      helperPolicies = (await h.one(`select count(*)::int as n from pg_policies where schemaname = 'public' and cmd = 'SELECT' and tablename = any($1) and policyname <> 'org_wall_header' and qual ~ '\\m(is_group_member|is_group_coach|is_org_admin_of_group)\\('`, [TABLES])).n;
      h.check("the fixture: the owner cannot see the private client's program, the coach and the client themselves can", before["owner:private program"] === 0 && before["coach:private program"] === 1 && before["privateClient:private program"] === 1, JSON.stringify(before));
    },
    async "0427"({ db, h }) {
      const left = await h.one(`select count(*)::int as n from pg_policies where schemaname = 'public' and cmd = 'SELECT' and tablename = any($1) and policyname <> 'org_wall_header' and qual ~ '\\m(is_group_member|is_group_coach|is_org_admin_of_group)\\('`, [TABLES]);
      h.check("no read policy on the ten tables still calls the per-row member checks", left.n === 0, String(left.n));
      const sets = await h.one(`select count(*)::int as n from pg_policies where schemaname = 'public' and cmd = 'SELECT' and tablename = any($1) and qual ~ 'my_(group|coached_group|admin_group)_ids\\(\\)'`, [TABLES]);
      h.check(`every read policy that used the per-row checks (${helperPolicies}) now reads the sets (15 on the live database)`, helperPolicies > 0 && sets.n === helperPolicies, `${sets.n} of ${helperPolicies}`);
      const after = await counts(db, h);
      const diff = Object.keys(before).filter((k) => before[k] !== after[k]);
      h.check("every person sees exactly the same number of rows in all ten tables (owner, coach, client, private client)", diff.length === 0, JSON.stringify(diff.map((k) => [k, before[k], after[k]])));
      h.check("the private client is still hidden from the owner, and visible to the coach and to themselves", after["owner:private program"] === 0 && after["coach:private program"] === 1 && after["privateClient:private program"] === 1);
      await h.as(people.coach);
      const ids = (await db.query(`select public.my_coached_group_ids() as id`)).rows.map((r) => r.id);
      h.check("the sets answer only for the caller", ids.length === 2, JSON.stringify(ids));
      await h.asSuper();

      // The undo file puts every read policy back to its exact text; then the step is applied again (later tests see the applied state).
      const { readFileSync } = await import("node:fs");
      const here = new URL("../../../", import.meta.url);
      await db.exec(readFileSync(new URL("supabase/apply/undo-step179-0427.sql", here), "utf8"));
      h.check("the undo restores every read policy text exactly", (await policyTexts(h)) === textsBefore);
      await db.exec(readFileSync(new URL("supabase/migrations/0427_member_checks_set_based.sql", here), "utf8"));
    },
  },
};
