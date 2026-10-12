// 0358: a personal space. One space per person that belongs to no organization: the person's own programs, check-ins and weights live there as ONE set that follows them into every organization they coach
// in. They read and write it under any workspace header (switch on or off); nobody else (an organization's owner or admin, a rival coach, a stranger, an anonymous caller) reads any of it; no one else can be
// seated in it; it cannot be moved into an organization; asking twice returns the same space.
const HEADER = (groupId) => JSON.stringify({ "x-workspace-group": groupId });

export default {
  name: "0358 personal space: one set of personal data, owned by the person, in no organization",
  migrations: ["0348", "0349", "0358"],
  phases: {
    async "0358"({ db, h }) {
      const ownerA = await h.user("PS Owner A");
      const ownerB = await h.user("PS Owner B");
      const coach = await h.user("PS Coach Both");
      const rival = await h.user("PS Rival");
      const stranger = await h.user("PS Stranger");
      const orgA = await h.org(ownerA);
      const orgB = await h.org(ownerB);
      await h.orgMember(orgA, coach, "coach");
      await h.orgMember(orgB, coach, "coach");
      await h.orgMember(orgA, rival, "admin");
      const gA = await h.group(orgA, coach, "team", "PS team A");
      const gB = await h.group(orgB, coach, "team", "PS team B");

      const setHeader = (v) => db.query(`select set_config('request.headers', $1, false)`, [v]);
      const count = async (table, where = "true") => (await db.query(`select count(*)::int as n from public.${table} where ${where}`)).rows[0].n;

      // Switch the wall ON (the 0349 step) so the header rule is really in force.
      await h.asSuper();
      await db.exec(`create or replace function public.org_wall_header_enabled() returns boolean language sql stable set search_path = public as $$ select true $$`);

      // ---- creating it ---------------------------------------------------------------------------------
      await h.as(coach);
      const ps = (await db.query("select public.ensure_personal_space() as id")).rows[0].id;
      const again = (await db.query("select public.ensure_personal_space() as id")).rows[0].id;
      h.check("asking for the personal space twice returns the same space", ps && ps === again);
      const g = (await db.query("select organization_id, group_kind, created_by, name from public.groups where id = $1", [ps])).rows[0];
      h.check("it belongs to no organization, is the person's, and is named after their profile", g.organization_id === null && g.created_by === coach && g.name === "PS Coach Both");
      h.check("the person is its coach and its only member", (await count("group_memberships", `group_id = '${ps}'`)) === 1 && (await count("group_memberships", `group_id = '${ps}' and profile_id = '${coach}' and role = 'coach'`)) === 1);
      await h.expectError("a signed-in person cannot create a second personal space by hand", async () => {
        await h.asSuper();
        await db.query("insert into public.groups (name, created_by, organization_id, group_kind) values ('dup', $1, null, 'one_on_one')", [coach]);
      }, /duplicate|unique/i);
      await h.as(null);
      await h.expectError("an anonymous caller cannot create one", () => db.query("select public.ensure_personal_space()"), /Sign in|permission denied/i);

      // ---- the person's own data, filed under their own id ----------------------------------------------
      await h.as(coach);
      await db.query(`insert into public.programs (group_id, name, created_by, athlete_id, is_active) values ($1, 'PS my program', $2, $2, true)`, [ps, coach]);
      await db.query(`insert into public.wellness_checkins (athlete_id, group_id, sleep_quality, soreness, energy) values ($2, $1, 4, 2, 5)`, [ps, coach]);
      await db.query(`insert into public.body_weight_logs (athlete_id, group_id, weight) values ($2, $1, 180)`, [ps, coach]);
      for (const [label, header] of [["no header", ""], ["a header naming organization A", HEADER(gA)], ["a header naming organization B", HEADER(gB)]]) {
        await setHeader(header);
        h.check(`${label}: the person reads their own program, check-in and weight`, (await count("programs", "name = 'PS my program'")) === 1 && (await count("wellness_checkins", `group_id = '${ps}'`)) === 1 && (await count("body_weight_logs", `group_id = '${ps}'`)) === 1);
        h.check(`${label}: and the space itself`, (await count("groups", `id = '${ps}'`)) === 1);
      }
      await setHeader(HEADER(gA));
      await db.query(`insert into public.wellness_checkins (athlete_id, group_id, sleep_quality, soreness, energy, log_date) values ($2, $1, 3, 3, 3, current_date + 1)`, [ps, coach]);
      h.check("under a header naming an organization the person can still write to their own space", (await count("wellness_checkins", `group_id = '${ps}'`)) === 2);
      await setHeader("");

      // ---- nobody else ------------------------------------------------------------------------------------
      for (const [label, who] of [["the owner of organization A", ownerA], ["the owner of organization B", ownerB], ["an organization admin", rival], ["a stranger", stranger], ["an anonymous caller", null]]) {
        await h.as(who);
        let n = 0;
        try {
          n = (await count("programs", "name = 'PS my program'")) + (await count("wellness_checkins", `group_id = '${ps}'`)) + (await count("body_weight_logs", `group_id = '${ps}'`)) + (await count("groups", `id = '${ps}'`)) + (await count("group_memberships", `group_id = '${ps}'`));
        } catch {
          n = 0;
        }
        h.check(`${label} reads none of it`, n === 0);
      }

      // ---- no one else can be seated, and it cannot be moved ---------------------------------------------
      await h.as(coach);
      await h.expectError("the person cannot seat anyone else in their personal space", () => db.query("insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')", [ps, stranger]), /belongs to one person|row-level security|policy/i);
      await h.asSuper();
      await h.expectError("not even the server can seat someone else (or the owner as a client)", () => db.query("insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [ps, stranger]), /belongs to one person/i);
      await h.expectError("...or the owner as an athlete", () => db.query("update public.group_memberships set role = 'athlete' where group_id = $1", [ps]), /belongs to one person|already|one client/i);
      await h.as(coach);
      await h.expectError("the person cannot move their personal space into an organization", () => db.query("update public.groups set organization_id = $1 where id = $2", [orgA, ps]), /cannot be moved/i);
      await h.expectError("...or move themselves from an organization group into it", () => db.query("update public.group_memberships set group_id = $1 where group_id = $2 and profile_id = $3", [ps, gA, coach]), /same organization|belongs to one person/i);

      // ---- real groups are unchanged ---------------------------------------------------------------------
      await h.asSuper();
      h.check("every organization group still has its organization", (await count("groups", "organization_id is null and id <> '" + ps + "'")) === 0);
      h.check("the personal space is in no organization's client list (the person is a coach there, never a client)", (await count("group_memberships", `group_id = '${ps}' and role = 'athlete'`)) === 0);
      await h.as(coach);
      await setHeader(HEADER(gA));
      h.check("a header naming organization A still shows only organization A's other rows (the wall still works)", (await count("groups", `id in ('${gA}', '${gB}')`)) === 2);
      await setHeader("");
    },
  },
};
