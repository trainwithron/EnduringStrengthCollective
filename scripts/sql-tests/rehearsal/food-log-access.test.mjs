// Food logging is for every client, whatever their tier and whether or not a target is set. This proves the data-access rules that make that safe, on the live-equivalent
// schema: a client reads and writes only their own food log (a group-tier client included), a coach of the client's group can read it but not write it, and a coach of
// another group sees nothing.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "food logging access (every tier)",
  migrations: [],
  phases: {
    async live({ db, h }) {
      const coach = await h.user("FL Coach");
      const otherCoach = await h.user("FL Other Coach");
      const ann = await h.user("FL Ann (group tier)");
      const bob = await h.user("FL Bob");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "FL group");
      await h.member(group, ann);
      await h.member(group, bob);
      const org2 = await h.org(otherCoach);
      const group2 = await h.group(org2, otherCoach, "team", "FL other group");
      await h.asSuper();
      await db.query(`update public.group_memberships set client_tier = 'group' where group_id = $1 and profile_id = $2`, [group, ann]);
      const tier = await h.one(`select client_tier from public.group_memberships where group_id = $1 and profile_id = $2`, [group, ann]);
      h.check("baseline: Ann is a group-tier client with no target", tier.client_tier === "group");
      const targets = await h.one(`select count(*)::int as n from public.daily_macros where athlete_id = $1`, [ann]);
      h.check("baseline: Ann has no daily target", targets.n === 0, JSON.stringify(targets));

      // ---- a group-tier client with no target logs, edits and deletes their own food ----
      await h.as(ann);
      const add = await tryQ(db, `insert into public.food_log_entries (athlete_id, group_id, log_date, meal_slot, status, description, calories, protein_g, carbs_g, fat_g) values ($1, $2, '2026-10-08', 'breakfast', 'quick_log', 'Greek yogurt', 150, 15, 8, 4) returning id`, [ann, group]);
      h.check("a group-tier client with no target can log food", !add.error && add.rows?.length === 1, JSON.stringify(add));
      const entryId = add.rows?.[0]?.id;
      const edit = await tryQ(db, `update public.food_log_entries set calories = 160 where id = $1 returning calories`, [entryId]);
      h.check("and edit their own entry", !edit.error && Number(edit.rows?.[0]?.calories) === 160, JSON.stringify(edit));
      const mine = await tryQ(db, `select count(*)::int as n from public.food_log_entries`);
      h.check("and reads their own log", mine.rows?.[0]?.n === 1, JSON.stringify(mine));

      // ---- nobody else writes it, other clients cannot read it ----
      await h.as(bob);
      const bobSees = await tryQ(db, `select count(*)::int as n from public.food_log_entries`);
      h.check("another client in the group cannot read Ann's log", bobSees.rows?.[0]?.n === 0, JSON.stringify(bobSees));
      const bobForge = await tryQ(db, `insert into public.food_log_entries (athlete_id, group_id, log_date, status, description, calories) values ($1, $2, '2026-10-08', 'quick_log', 'forged', 1)`, [ann, group]);
      h.check("and cannot log food as Ann", !!bobForge.error, JSON.stringify(bobForge));
      const bobEdit = await tryQ(db, `update public.food_log_entries set calories = 1 where id = $1 returning id`, [entryId]);
      h.check("and cannot edit Ann's entry", !bobEdit.error && (bobEdit.rows?.length ?? 0) === 0, JSON.stringify(bobEdit));
      const bobDel = await tryQ(db, `delete from public.food_log_entries where id = $1 returning id`, [entryId]);
      h.check("and cannot delete it", !bobDel.error && (bobDel.rows?.length ?? 0) === 0, JSON.stringify(bobDel));

      // ---- the client's coach reads it (any tier) but never writes it ----
      await h.as(coach);
      const coachSees = await tryQ(db, `select count(*)::int as n from public.food_log_entries where athlete_id = $1`, [ann]);
      h.check("the coach of the client's group can read a group-tier client's log", coachSees.rows?.[0]?.n === 1, JSON.stringify(coachSees));
      const coachWrite = await tryQ(db, `insert into public.food_log_entries (athlete_id, group_id, log_date, status, description, calories) values ($1, $2, '2026-10-08', 'quick_log', 'coach typed', 100)`, [ann, group]);
      h.check("but the coach cannot log food for the client", !!coachWrite.error, JSON.stringify(coachWrite));
      const coachEdit = await tryQ(db, `update public.food_log_entries set calories = 999 where id = $1 returning id`, [entryId]);
      h.check("or change what the client logged", !coachEdit.error && (coachEdit.rows?.length ?? 0) === 0, JSON.stringify(coachEdit));

      // ---- a coach of another group sees nothing ----
      await h.as(otherCoach);
      const otherSees = await tryQ(db, `select count(*)::int as n from public.food_log_entries`);
      h.check("a coach of a different group cannot read the client's log", otherSees.rows?.[0]?.n === 0, JSON.stringify(otherSees));

      // ---- the client can delete their own entry ----
      await h.as(ann);
      const del = await tryQ(db, `delete from public.food_log_entries where id = $1 returning id`, [entryId]);
      h.check("the client can delete their own entry", !del.error && del.rows?.length === 1, JSON.stringify(del));
      void group2;
    },
  },
};
