// 0370: the Needs attention list can be quieted. A "Not now" is a private row of the coach (one per client and kind of item); "No macros for [name]" is a nullable switch on the membership (empty counts as on)
// that the coach writes and the client can neither change nor see change.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0370 Not now and No macros for a client",
  migrations: ["0370"],
  phases: {
    async "0370"({ db, h }) {
      const coach = await h.user("NA Coach");
      const other = await h.user("NA Other Coach");
      const client = await h.user("NA Client");
      const org = await h.org(coach);
      await h.orgMember(org, other, "coach");
      const group = await h.group(org, coach, "team", "NA team");
      const otherGroup = await h.group(org, other, "team", "NA other team");
      await h.member(group, client);

      await h.asSuper();
      h.check("the macros switch starts empty, which counts as on", (await db.query(`select coach_sets_macros from public.group_memberships where group_id = $1 and profile_id = $2`, [group, client])).rows[0].coach_sets_macros === null);

      await h.as(coach);
      await db.query(`insert into public.attention_snoozes (coach_id, athlete_id, group_id, trigger_key, until_date) values ($1, $2, $3, 'macros_missing', current_date + 7)`, [coach, client, group]);
      h.check("a coach can put an item off for a week", (await db.query(`select count(*)::int as n from public.attention_snoozes where athlete_id = $1`, [client])).rows[0].n === 1);
      await db.query(`insert into public.attention_snoozes (coach_id, athlete_id, group_id, trigger_key, until_date) values ($1, $2, $3, 'macros_missing', current_date + 14) on conflict (coach_id, athlete_id, trigger_key) do update set until_date = excluded.until_date`, [coach, client, group]);
      h.check("putting it off again moves the date, one row per client and kind", (await db.query(`select count(*)::int as n from public.attention_snoozes where athlete_id = $1`, [client])).rows[0].n === 1);
      h.check("only the two kinds of item can be put off", (await msg(db, `insert into public.attention_snoozes (coach_id, athlete_id, group_id, trigger_key, until_date) values ($1, $2, $3, 'something_else', current_date)`, [coach, client, group])).includes("trigger_key"));
      h.check("a coach cannot put items off as another coach", (await msg(db, `insert into public.attention_snoozes (coach_id, athlete_id, group_id, trigger_key, until_date) values ($1, $2, $3, 'program_ending', current_date)`, [other, client, group])).length > 0);
      h.check("a coach cannot put off an item in a group they do not coach", (await msg(db, `insert into public.attention_snoozes (coach_id, athlete_id, group_id, trigger_key, until_date) values ($1, $2, $3, 'program_ending', current_date)`, [coach, client, otherGroup])).length > 0);

      const set = await db.query(`update public.group_memberships set coach_sets_macros = false where group_id = $1 and profile_id = $2 returning coach_sets_macros`, [group, client]);
      h.check("the coach can switch macros off for a client", set.rows.length === 1 && set.rows[0].coach_sets_macros === false);
      const back = await db.query(`update public.group_memberships set coach_sets_macros = true where group_id = $1 and profile_id = $2 returning coach_sets_macros`, [group, client]);
      h.check("and back on", back.rows.length === 1 && back.rows[0].coach_sets_macros === true);

      await h.as(other);
      h.check("another coach sees none of the put-off items", (await db.query(`select count(*)::int as n from public.attention_snoozes`)).rows[0].n === 0);
      const theirs = await db.query(`update public.group_memberships set coach_sets_macros = false where group_id = $1 and profile_id = $2 returning 1`, [group, client]);
      h.check("another coach cannot change the switch", theirs.rows.length === 0);

      await h.as(client);
      h.check("the client never reads the put-off items", (await db.query(`select count(*)::int as n from public.attention_snoozes`)).rows[0].n === 0);
      const own = await db.query(`update public.group_memberships set coach_sets_macros = false where group_id = $1 and profile_id = $2 returning 1`, [group, client]);
      h.check("the client cannot change the switch", own.rows.length === 0);
    },
  },
};
