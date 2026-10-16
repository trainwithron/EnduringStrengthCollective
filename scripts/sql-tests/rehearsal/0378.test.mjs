// 0378: moving a client to another group moves ALL of their records (every table with athlete_id and group_id), not just the sixteen the function used to know. Rows are filed generically in every such table
// the database lets a plain row into; after the move none may remain in the old group (except the old group's own structures), and all of them must be in the new one.
const STAY = ["group_session_attendees", "package_group_access", "kiosk_pins", "kiosk_checkins", "game_score_entries"];

export default {
  name: "0378 Moving a client moves every record of theirs",
  migrations: ["0378"],
  phases: {
    async "0378"({ db, h }) {
      const coach = await h.user("MV Coach");
      const client = await h.user("MV Client");
      const other = await h.user("MV Other Client");
      const org = await h.org(coach);
      const from = await h.group(org, coach, "team", "MV from");
      const to = await h.group(org, coach, "team", "MV to");
      await h.member(from, client);
      await h.member(from, other);

      await h.asSuper();
      const tables = (
        await db.query(`select c.table_name from information_schema.columns c
          join information_schema.columns g on g.table_schema = 'public' and g.table_name = c.table_name and g.column_name = 'group_id'
          join information_schema.tables t on t.table_schema = 'public' and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
          where c.table_schema = 'public' and c.column_name = 'athlete_id' order by 1`)
      ).rows.map((r) => r.table_name);

      // A plain row for (athlete, group) in each table: every required column given a value by its type; a table that needs a real related row is skipped.
      const seeded = [];
      const seededOther = [];
      for (const table of tables) {
        for (const who of [client, other]) {
          const cols = (
            await db.query(`select column_name, data_type, udt_name, is_nullable, column_default, is_generated, is_identity from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table])
          ).rows;
          const names = [];
          const vals = [];
          const params = [];
          for (const c of cols) {
            if (c.is_generated === "ALWAYS" || c.is_identity === "YES") continue;
            if (c.column_name === "athlete_id") { names.push("athlete_id"); params.push(who); vals.push(`$${params.length}`); continue; }
            if (c.column_name === "group_id") { names.push("group_id"); params.push(from); vals.push(`$${params.length}`); continue; }
            if (c.is_nullable === "YES" || c.column_default) continue;
            names.push(c.column_name);
            const t = c.udt_name;
            if (t === "uuid") { params.push(coach); vals.push(`$${params.length}`); }
            else if (["text", "varchar", "bpchar"].includes(t)) vals.push("'x'");
            else if (["int2", "int4", "int8", "numeric", "float4", "float8"].includes(t)) vals.push("1");
            else if (t === "bool") vals.push("false");
            else if (t === "date") vals.push("current_date");
            else if (t === "timestamptz" || t === "timestamp") vals.push("now()");
            else if (t === "jsonb" || t === "json") vals.push("'{}'");
            else vals.push("null");
          }
          try {
            await db.query(`insert into public.${table} (${names.join(", ")}) values (${vals.join(", ")})`, params);
            if (who === client) seeded.push(table);
            else seededOther.push(table);
          } catch {
            /* a table that needs a real related row: skipped */
          }
        }
      }
      h.check(`rows were filed for the client in ${seeded.length} tables (at least 20)`, seeded.length >= 20);
      console.log("   seeded: " + seeded.join(", "));

      await h.as(coach);
      await db.query(`select public.move_client_to_group($1, $2, $3)`, [client, from, to]);
      await h.asSuper();

      const left = [];
      const notMoved = [];
      for (const table of seeded) {
        const inOld = (await db.query(`select count(*)::int as n from public.${table} where athlete_id = $1 and group_id = $2`, [client, from])).rows[0].n;
        const inNew = (await db.query(`select count(*)::int as n from public.${table} where athlete_id = $1 and group_id = $2`, [client, to])).rows[0].n;
        if (STAY.includes(table)) {
          if (inOld === 0) notMoved.push(table + " (should have stayed)");
        } else {
          if (inOld > 0) left.push(table);
          if (inNew === 0) notMoved.push(table);
        }
      }
      h.check("no record of the client is left in the old group" + (left.length ? ": " + left.join(", ") : ""), left.length === 0);
      h.check("every record is now in the new group, and the old group's own structures stayed" + (notMoved.length ? ": " + notMoved.join(", ") : ""), notMoved.length === 0);

      // The other client's records are untouched.
      const otherLeft = [];
      for (const table of seededOther) {
        const n = (await db.query(`select count(*)::int as n from public.${table} where athlete_id = $1 and group_id = $2`, [other, from])).rows[0].n;
        if (n === 0) otherLeft.push(table);
      }
      h.check("another client of the old group keeps all of theirs there" + (otherLeft.length ? ": " + otherLeft.join(", ") : ""), otherLeft.length === 0);

      // The organization wall and the role checks still hold.
      await h.as(coach);
      const roleAfter = await h.one(`select current_setting('request.jwt.claim.role', true) as r`);
      h.check("the caller's own role is back after the move", roleAfter.r === "authenticated");
      const outsider = await h.user("MV Outsider Coach");
      const org2 = await h.org(outsider);
      const g2 = await h.group(org2, outsider, "team", "MV other org");
      await h.member(from, other, "athlete").catch(() => {});
      await h.expectErrorAs(coach, "a coach who does not coach the destination cannot move a client there", `select public.move_client_to_group($1, $2, $3)`, [other, from, g2], /coach both|same organization/i);
    },
  },
};
