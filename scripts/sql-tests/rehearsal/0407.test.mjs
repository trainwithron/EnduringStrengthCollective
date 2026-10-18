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
      await db.query(`insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate) select id, group_id, profile_id, 125 from public.group_memberships where group_id = $1 and profile_id = $2`, [g, ann]);
      const oldMembership = (await db.query(`select id from public.group_memberships where group_id = $1 and profile_id = $2`, [g, ann])).rows[0].id;

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
      const rate = (await db.query(`select r.monthly_rate::float as rate, r.membership_id from public.client_billing_rates r join public.group_memberships gm on gm.id = r.membership_id where gm.group_id = $1 and gm.profile_id = $2`, [g, ann])).rows[0];
      h.check("their rate comes back too, against the new membership", rate && rate.rate === 125 && rate.membership_id !== oldMembership, JSON.stringify({ rate, oldMembership }));

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

      // ---- a live subscription in this group refuses the removal (checked now, not on day 30)
      const sub = await h.user("RM Sub");
      await h.member(g, sub);
      await db.query(`insert into public.membership_subscriptions (athlete_id, group_id, stripe_subscription_id, status) values ($1, $2, 'sub_rm_1', 'active')`, [sub, g]);
      r = await callAs(coach, `select public.remove_client($1, $2)`, [g, sub]);
      h.check("a client with a live subscription cannot be removed", !!r.error && /live subscription/i.test(r.error), JSON.stringify(r));
      r = await callAs(coach, `select public.remove_client($1, $2, true, false)`, [g, sub]);
      h.check("nor deleted permanently", !!r.error && /live subscription/i.test(r.error), JSON.stringify(r));
      await db.query(`update public.membership_subscriptions set status = 'canceled' where athlete_id = $1`, [sub]);
      r = await callAs(coach, `select public.remove_client($1, $2)`, [g, sub]);
      h.check("once the subscription is cancelled they can be", !r.error, JSON.stringify(r));

      // ---- upcoming sessions end, past ones stay, credits come back
      const bk = await h.user("RM Booker");
      await h.member(g, bk);
      await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at) values ($1, $2, $3, now() + interval '2 days', now() + interval '2 days 1 hour'), ($1, $2, $3, now() - interval '3 days', now() - interval '3 days' + interval '1 hour')`, [coach, bk, g]);
      r = await callAs(coach, `select public.remove_client($1, $2) as id`, [g, bk]);
      const bkRemoval = r.rows?.[0]?.id;
      h.check("removing a client with upcoming sessions works" + (r.error ? ": " + r.error : ""), !r.error && !!bkRemoval);
      const bks = (await db.query(`select status, start_at > now() as future from public.bookings where athlete_id = $1 order by start_at`, [bk])).rows;
      h.check("the upcoming session is cancelled and the past one is left alone", bks.length === 2 && bks[0].status === "confirmed" && bks[1].status === "cancelled", JSON.stringify(bks));
      h.check("the removal says how many were cancelled", (await db.query(`select cancelled_bookings from public.client_removals where id = $1`, [bkRemoval])).rows[0].cancelled_bookings === 1);

      // ---- a one-on-one space with no client left leaves the lists, and comes back with them
      const solo = await h.user("RM Solo Client");
      const g3 = await h.group(org, coach, "one_on_one", "RM Solo");
      await h.member(g3, solo);
      r = await callAs(coach, `select public.remove_client($1, $2) as id`, [g3, solo]);
      const soloRemoval = r.rows?.[0]?.id;
      h.check("the one-on-one space is archived when its only client leaves", !r.error && (await db.query(`select archived_at is not null as a from public.groups where id = $1`, [g3])).rows[0].a === true, JSON.stringify(r));
      await callAs(coach, `select public.restore_removed_client($1)`, [soloRemoval]);
      h.check("and un-archived when they are put back", (await db.query(`select archived_at is null as a from public.groups where id = $1`, [g3])).rows[0].a === true);
      h.check("a team is never archived by a removal", (await db.query(`select archived_at is null as a from public.groups where id = $1`, [g])).rows[0].a === true);

      // ---- invited back in after a plain removal, then removed again: no raw error, one open record
      const dee = await h.user("RM Dee");
      await h.member(g, dee);
      r = await callAs(coach, `select public.remove_client($1, $2) as id`, [g, dee]);
      const deeFirst = r.rows?.[0]?.id;
      await h.member(g, dee);
      r = await callAs(coach, `select public.remove_client($1, $2) as id`, [g, dee]);
      h.check("removed again after being invited back works" + (r.error ? ": " + r.error : ""), !r.error && !!r.rows?.[0]?.id && r.rows[0].id !== deeFirst, JSON.stringify(r));
      const open = (await db.query(`select count(*)::int as n from public.client_removals where group_id = $1 and athlete_id = $2 and restored_at is null and purged_at is null`, [g, dee])).rows[0].n;
      h.check("and there is only one open record for them", open === 1, String(open));

      // ---- putting back when something changed since
      const eve = await h.user("RM Eve");
      await h.member(g, eve);
      const pos2 = (await db.query(`insert into public.group_positions (group_id, name, sort_order) values ($1, 'Kickers', 2) returning id`, [g])).rows[0].id;
      await db.query(`update public.group_memberships set position_id = $1 where group_id = $2 and profile_id = $3`, [pos2, g, eve]);
      r = await callAs(coach, `select public.remove_client($1, $2) as id`, [g, eve]);
      const eveRemoval = r.rows?.[0]?.id;
      await db.query(`delete from public.group_positions where id = $1`, [pos2]);
      await db.query(`update public.client_removals set erasing_since = now() where id = $1`, [eveRemoval]);
      r = await callAs(coach, `select public.restore_removed_client($1)`, [eveRemoval]);
      h.check("a client whose erase is under way cannot be put back, and is told why in plain words", !!r.error && /being deleted/i.test(r.error), JSON.stringify(r));
      await db.query(`update public.client_removals set erasing_since = null where id = $1`, [eveRemoval]);
      r = await callAs(coach, `select public.restore_removed_client($1)`, [eveRemoval]);
      h.check("a position deleted since is dropped, not a failure" + (r.error ? ": " + r.error : ""), !r.error);
      h.check("and they are back without the position", (await db.query(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2 and position_id is null`, [g, eve])).rows[0].n === 1);

      // ---- a column added after the removal comes back with its own default, not null
      const fay = await h.user("RM Fay");
      await h.member(g, fay);
      r = await callAs(coach, `select public.remove_client($1, $2) as id`, [g, fay]);
      const fayRemoval = r.rows?.[0]?.id;
      await db.query(`alter table public.group_memberships add column z_later int not null default 7`);
      try {
        r = await callAs(coach, `select public.restore_removed_client($1)`, [fayRemoval]);
        const back2 = (await db.query(`select z_later from public.group_memberships where group_id = $1 and profile_id = $2`, [g, fay])).rows[0];
        h.check("a later NOT NULL DEFAULT column takes its default when an older record is put back" + (r.error ? ": " + r.error : ""), !r.error && back2?.z_later === 7, JSON.stringify(back2));
      } finally {
        await db.query(`alter table public.group_memberships drop column if exists z_later`);
      }

      // ---- someone else's group is unaffected
      h.check("the other coach's group is untouched", g2 !== null);
    },
  },
};
