// 0407: taking a client out of a group keeps everything but the membership, can be undone exactly, and a permanent delete carries a 30-day date.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0407 Client removals",
  migrations: ["0407"],
  phases: {
    async "0407"({ db, h }) {
      const coach = await h.user("RM Coach");
      const other = await h.user("RM Other Coach");
      const ann = await h.user("RM Ann");
      const bo = await h.user("RM Bo");
      const org = await h.org(coach, "RM Gym");
      await h.orgMember(org, other, "coach");
      const g = await h.group(org, coach, "team", "RM Team");
      const g2 = await h.group(org, other, "team", "RM Other Team");
      await h.member(g, ann);
      await h.member(g, bo);
      await h.asSuper();
      const pos = (await db.query(`insert into public.group_positions (group_id, name, sort_order) values ($1, 'Linemen', 1) returning id`, [g])).rows[0].id;
      await db.query(`update public.group_memberships set client_tier = 'online', training_level = 'advanced', position_id = $1, depth_order = 3, private_from_org = true where group_id = $2 and profile_id = $3`, [pos, g, ann]);
      await db.query(`insert into public.workout_logs (session_id, athlete_id, group_id, workout_id) select null, $1, $2, null where false`, [ann, g]).catch(() => undefined);

      const callAs = async (who, sql, params) => { await h.as(who); const r = await tryQ(db, sql, params); await h.asSuper(); return r; };

      // ---- only a coach of the group, only a client of it
      let r = await callAs(other, `select public.remove_client($1, $2)`, [g, ann]);
      h.check("a coach of another group cannot remove this group's client", !!r.error, JSON.stringify(r));
      r = await callAs(ann, `select public.remove_client($1, $2)`, [g, bo]);
      h.check("a client cannot remove a teammate", !!r.error, JSON.stringify(r));
      r = await callAs(coach, `select public.remove_client($1, $2)`, [g, coach]);
      h.check("a coach cannot remove themselves", !!r.error, JSON.stringify(r));
      r = await callAs(coach, `select public.remove_client($1, $2)`, [g, other]);
      h.check("nor someone who is not a client of the group", !!r.error, JSON.stringify(r));

      // ---- Remove from my clients
      r = await callAs(coach, `select public.remove_client($1, $2) as id`, [g, ann]);
      const removal = r.rows?.[0]?.id;
      h.check("a coach removes a client" + (r.error ? ": " + r.error : ""), !r.error && !!removal);
      h.check("the membership is gone (no longer in lists, counts or the group)", (await db.query(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2`, [g, ann])).rows[0].n === 0);
      h.check("but the account is untouched", (await db.query(`select count(*)::int as n from public.profiles where id = $1`, [ann])).rows[0].n === 1);
      const row = (await db.query(`select athlete_name, athlete_email, delete_after, membership from public.client_removals where id = $1`, [removal])).rows[0];
      h.check("the record keeps their name and their email, and no deletion date", row.athlete_name === "RM Ann" && /@/.test(row.athlete_email ?? "") && row.delete_after === null, JSON.stringify({ n: row.athlete_name, e: row.athlete_email, d: row.delete_after }));
      h.check("and the membership exactly as it was", row.membership.client_tier === "online" && row.membership.training_level === "advanced" && row.membership.depth_order === 3 && row.membership.private_from_org === true);
      r = await callAs(coach, `select count(*)::int as n from public.client_removals where group_id = $1`, [g]);
      h.check("the coach can read the removals of their group", r.rows?.[0]?.n === 1, JSON.stringify(r));
      r = await callAs(other, `select count(*)::int as n from public.client_removals`);
      h.check("another coach cannot", r.rows?.[0]?.n === 0, JSON.stringify(r));
      r = await callAs(ann, `select count(*)::int as n from public.client_removals`);
      h.check("nor can the removed client", r.rows?.[0]?.n === 0, JSON.stringify(r));
      r = await callAs(coach, `insert into public.client_removals (group_id, athlete_id, membership) values ($1, $2, '{}'::jsonb)`, [g, bo]);
      h.check("nobody writes to the table directly", !!r.error, JSON.stringify(r));
      r = await callAs(coach, `select public.remove_client($1, $2)`, [g, ann]);
      h.check("removing the same person again is refused (they are no longer a client)", !!r.error);

      // ---- put them back
      r = await callAs(other, `select public.restore_removed_client($1)`, [removal]);
      h.check("a coach of another group cannot put them back", !!r.error, JSON.stringify(r));
      r = await callAs(coach, `select public.restore_removed_client($1)`, [removal]);
      h.check("the coach puts them back" + (r.error ? ": " + r.error : ""), !r.error);
      const back = (await db.query(`select role, client_tier, training_level, position_id, depth_order, private_from_org from public.group_memberships where group_id = $1 and profile_id = $2`, [g, ann])).rows[0];
      h.check("exactly as they were: tier, level, position, depth and privacy", back && back.role === "athlete" && back.client_tier === "online" && back.training_level === "advanced" && back.position_id === pos && back.depth_order === 3 && back.private_from_org === true, JSON.stringify(back));
      r = await callAs(coach, `select public.restore_removed_client($1)`, [removal]);
      h.check("putting back twice is refused", !!r.error, JSON.stringify(r));

      // ---- Delete permanently: 30 days to undo
      r = await callAs(coach, `select public.remove_client($1, $2, true, true) as id`, [g, bo]);
      const del = r.rows?.[0]?.id;
      const d = (await db.query(`select delete_after, erase_history, delete_after > now() + interval '29 days' as far, delete_after < now() + interval '31 days' as near from public.client_removals where id = $1`, [del])).rows[0];
      h.check("a permanent delete is the same removal with a date 30 days away, and remembers the history choice", d && d.far && d.near && d.erase_history === true, JSON.stringify(d));
      h.check("the account is still there during the 30 days", (await db.query(`select count(*)::int as n from public.profiles where id = $1`, [bo])).rows[0].n === 1);
      r = await callAs(coach, `select public.restore_removed_client($1)`, [del]);
      const cleared = (await db.query(`select delete_after, restored_at is not null as r from public.client_removals where id = $1`, [del])).rows[0];
      h.check("undoing it within the window puts them back and cancels the date", !r.error && cleared.delete_after === null && cleared.r === true, JSON.stringify(cleared));
      h.check("the audit trail has the removals and the restorations", (await db.query(`select count(*)::int as n from public.audit_log where table_name = 'group_memberships' and changed ->> 'event' in ('client_removed', 'client_deleted_30_day_undo', 'client_restored')`)).rows[0].n >= 4);

      // ---- someone else's group is unaffected
      h.check("the other coach's group is untouched", g2 !== null);
    },
  },
};
