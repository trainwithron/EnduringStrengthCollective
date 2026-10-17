// 0392: what a coach coaches (nullable, three values only) and choosing which coach holds a new client.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0392 Coach type and assigning a coach",
  migrations: ["0392"],
  phases: {
    async "0392"({ db, h }) {
      const owner = await h.user("CT Owner");
      const coach = await h.user("CT Coach");
      const outsider = await h.user("CT Outsider");
      const client = await h.user("CT Client");
      const privateClient = await h.user("CT Private Client");
      const org = await h.org(owner, "CT Gym");
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, owner, "one_on_one", "CT one on one");
      await h.member(g, client);
      const pg = await h.group(org, owner, "one_on_one", "CT private");
      await h.member(pg, privateClient);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [pg, privateClient]);

      // ---- coach type
      await h.as(owner);
      let r = await tryQ(db, `update public.profiles set coach_type = 'team' where id = $1`, [owner]);
      h.check("a coach can say what they coach" + (r.error ? ": " + r.error : ""), !r.error);
      r = await tryQ(db, `update public.profiles set coach_type = 'astronaut' where id = $1`, [owner]);
      h.check("only the three kinds are accepted", !!r.error);
      await h.asSuper();
      h.check("a profile with no answer is allowed (every coach before this)", (await db.query(`select coach_type from public.profiles where id = $1`, [coach])).rows[0].coach_type === null);

      // ---- assigning a coach
      await h.as(outsider);
      r = await tryQ(db, `select public.assign_group_coach($1, $2)`, [g, coach]);
      h.check("someone outside the organization cannot choose a group's coach", /Only an owner/.test(r.error ?? ""), r.error);
      await h.as(owner);
      r = await tryQ(db, `select public.assign_group_coach($1, $2)`, [g, outsider]);
      h.check("the coach must be a member of the organization", /member of this organization/.test(r.error ?? ""), r.error);
      // an owner or admin who does NOT coach the private client's group can never get a seat there, for themselves or anyone
      const admin = await h.user("CT Admin");
      await h.orgMember(org, admin, "admin");
      const privOwnerless = await h.group(org, coach, "one_on_one", "CT private (coach only)");
      const pk = await h.user("CT Private Two");
      await h.member(privOwnerless, pk);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [privOwnerless, pk]);
      await h.as(admin);
      r = await tryQ(db, `select public.assign_group_coach($1, $2)`, [privOwnerless, admin]);
      h.check("an admin who does not coach a private client's group cannot give themselves a seat", /private from the organization/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.assign_group_coach($1, $2)`, [privOwnerless, owner]);
      h.check("nor can they give the owner one", /private from the organization/.test(r.error ?? ""), r.error);
      await h.as(owner);
      r = await tryQ(db, `select public.assign_group_coach($1, $2)`, [privOwnerless, owner]);
      h.check("even the owner, who does not coach it, is refused", /private from the organization/.test(r.error ?? ""), r.error);
      await h.as(coach);
      r = await tryQ(db, `select public.assign_group_coach($1, $2, false)`, [privOwnerless, admin]);
      h.check("the private client's own coach can still hand them on", !r.error, r.error);
      await h.orgMember(org, client, "coach"); // a client of the group who is also staff in the organization
      await h.as(owner);
      r = await tryQ(db, `select public.assign_group_coach($1, $2)`, [g, client]);
      h.check("a client of the group cannot be made its coach", /client in this group/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.assign_group_coach($1, $2)`, [g, coach]);
      h.check("an owner assigns a coach to a new client" + (r.error ? ": " + r.error : ""), !r.error);
      await h.asSuper();
      const seats = (await db.query(`select profile_id from public.group_memberships where group_id = $1 and role = 'coach'`, [g])).rows.map((x) => x.profile_id);
      h.check("the chosen coach holds the group and the owner stepped out", seats.length === 1 && seats[0] === coach, JSON.stringify(seats));
      h.check("the client is still in it", (await db.query(`select 1 from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'athlete'`, [g, client])).rows.length === 1);
    },
  },
};
