// 0317: a package can include access to a group. Proves the new column starts empty on existing packages, a package can name a group and loses the link (not the package) if that group is
// deleted, and the record of the access (package_group_access) is server-only: no signed-in or signed-out user can read or write it, and it goes with the client or the package.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0317 package group access",
  migrations: ["0317"],
  phases: {
    async "0317"({ db, h }) {
      const coach = await h.user("PGA Coach");
      const ann = await h.user("PGA Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "PGA home group");
      const access = await h.group(org, coach, "team", "PGA access group");
      await h.member(group, ann);

      await h.asSuper();
      const col = await h.one("select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'group_access_group_id'");
      h.check("the group-access column exists and is optional", col && col.data_type === "uuid" && col.is_nullable === "YES", JSON.stringify(col));

      const plain = (await db.query("insert into public.coach_packages (coach_id, group_id, name, sessions_per_week, billing_type, sessions_granted, rate_cents) values ($1, $2, 'Plain', 1, 'one_time', 4, 5000) returning id, group_access_group_id", [coach, group])).rows[0];
      h.check("a package made without it has no group access", plain.group_access_group_id === null);
      const withAccess = (await db.query("insert into public.coach_packages (coach_id, group_id, name, sessions_per_week, billing_type, sessions_granted, rate_cents, group_access_group_id) values ($1, $2, 'With group', 1, 'one_time', 4, 5000, $3) returning id", [coach, group, access])).rows[0].id;
      h.check("a package can name a group", (await h.one("select group_access_group_id from public.coach_packages where id = $1", [withAccess])).group_access_group_id === access);

      // the record of what a package gave
      await db.query("insert into public.package_group_access (athlete_id, group_id, coach_package_id, created_membership) values ($1, $2, $3, true)", [ann, access, withAccess]);
      const dup = await tryQ(db, "insert into public.package_group_access (athlete_id, group_id, coach_package_id) values ($1, $2, $3)", [ann, access, withAccess]);
      h.check("the same client, group and package are recorded once", !!dup.error, JSON.stringify(dup));

      // nobody but the server can touch it
      await h.as(coach);
      const coachRead = await tryQ(db, "select * from public.package_group_access");
      const coachWrite = await tryQ(db, "insert into public.package_group_access (athlete_id, group_id, coach_package_id) values ($1, $2, $3)", [ann, access, plain.id]);
      h.check("a coach cannot read or write the access records", !!coachRead.error && !!coachWrite.error, JSON.stringify({ coachRead, coachWrite }));
      await h.as(ann);
      const annRead = await tryQ(db, "select * from public.package_group_access");
      const annDelete = await tryQ(db, "delete from public.package_group_access");
      h.check("nor can the client", !!annRead.error && !!annDelete.error, JSON.stringify({ annRead, annDelete }));
      await h.asSuper();
      const grants = await h.one("select has_table_privilege('anon', 'public.package_group_access', 'select') as a, has_table_privilege('authenticated', 'public.package_group_access', 'select') as b, has_table_privilege('authenticated', 'public.package_group_access', 'insert') as c");
      h.check("signed-out and signed-in users have no rights on it", !grants.a && !grants.b && !grants.c, JSON.stringify(grants));

      // deleting the group keeps the package and just clears the link; the record goes with the group
      await db.query("delete from public.groups where id = $1", [access]);
      const after = await h.one("select group_access_group_id from public.coach_packages where id = $1", [withAccess]);
      h.check("if the group is deleted the package stays and only loses the link", after && after.group_access_group_id === null, JSON.stringify(after));
      h.check("and the access record goes with the group", (await h.rows("select 1 from public.package_group_access")).length === 0);
    },
  },
};
