// 0375: InBody scans. A scan is written only by save_body_scan (the person themself, or a coach of the group, for a person in the group); the client and the group's coaches read it, nobody else; the
// table refuses impossible numbers; a scan's weight becomes that day's weigh-in only when asked and never over one already logged; delete is the client's, or the coach's for a scan they added.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0375 InBody scans",
  migrations: ["0375"],
  phases: {
    async "0375"({ db, h }) {
      const coach = await h.user("IB Coach");
      const coach2 = await h.user("IB Second Coach");
      const stranger = await h.user("IB Other Coach");
      const client = await h.user("IB Client");
      const client2 = await h.user("IB Other Client");
      const org = await h.org(coach);
      await h.orgMember(org, coach2, "coach");
      const group = await h.group(org, coach, "team", "IB team");
      await h.member(group, client);
      await h.member(group, client2);
      const org2 = await h.org(stranger);
      const group2 = await h.group(org2, stranger, "team", "IB other");

      const values = { scanDate: "2026-08-12", weightLb: 182.4, skeletalMuscleLb: 82.1, bodyFatMassLb: 31.8, percentBodyFat: 17.4, leanMassLb: 150.6, bmi: 24.9, totalBodyWaterL: 52.3, ecwRatio: 0.38, visceralLevel: 7, bmrKcal: 1790, inbodyScore: 78, segments: { rightArm: { leanLb: 8.4, fatLb: 1.5 } } };
      const save = (who, athlete, group_, v, path, weighIn) => tryQ(db, `select public.save_body_scan($1, $2, $3::jsonb, $4, $5) as r`, [group_, athlete, JSON.stringify(v), path, weighIn]);

      // the client saves their own
      await h.as(client);
      const mine = await save(client, client, group, values, `${group}/${client}/a.jpg`, true);
      h.check("a client can save their own scan" + (mine.error ? ": " + mine.error : ""), !mine.error && !!mine.rows?.[0]?.r?.id);
      h.check("...and with Use as weigh-in, the scan's weight is that day's weigh-in", mine.rows?.[0]?.r?.weighInSaved === true && Number((await db.query(`select weight from public.body_weight_logs where athlete_id = $1 and logged_date = '2026-08-12'`, [client])).rows[0]?.weight) === 182.4);
      const again = await save(client, client, group, { ...values, weightLb: 190 }, null, true);
      h.check("a second scan the same day never overwrites the weigh-in", again.rows?.[0]?.r?.weighInSaved === false && Number((await db.query(`select weight from public.body_weight_logs where athlete_id = $1 and logged_date = '2026-08-12'`, [client])).rows[0].weight) === 182.4);
      const noWeighIn = await save(client, client, group, { ...values, scanDate: "2026-08-13" }, null, false);
      h.check("without Use as weigh-in, no weigh-in is made", noWeighIn.rows?.[0]?.r?.weighInSaved === false && (await db.query(`select count(*)::int as n from public.body_weight_logs where athlete_id = $1 and logged_date = '2026-08-13'`, [client])).rows[0].n === 0);
      h.check("a scan with no photo is saved as manual, with one as photo", (await db.query(`select source from public.body_scans where athlete_id = $1 and photo_path is null limit 1`, [client])).rows[0].source === "manual" && (await db.query(`select source from public.body_scans where athlete_id = $1 and photo_path is not null limit 1`, [client])).rows[0].source === "photo");

      // refusals
      h.check("a client cannot save a scan for another person", !!(await save(client, client2, group, values, null, false)).error);
      h.check("the photo must be stored under the person's own folder", !!(await save(client, client, group, values, `${group}/${client2}/x.jpg`, false)).error);
      h.check("a scan needs a date, and not one in the future", !!(await save(client, client, group, { ...values, scanDate: "" }, null, false)).error && !!(await save(client, client, group, { ...values, scanDate: "2099-01-01" }, null, false)).error);
      h.check("impossible numbers are refused (body fat 400 percent, weight 5 lb)", !!(await save(client, client, group, { ...values, percentBodyFat: 400 }, null, false)).error && !!(await save(client, client, group, { ...values, weightLb: 5 }, null, false)).error);
      h.check("nothing writes the table directly", !!(await tryQ(db, `insert into public.body_scans (athlete_id, group_id, scan_date, uploaded_by) values ($1, $2, '2026-08-01', $1)`, [client, group])).error);
      await h.as(stranger);
      h.check("a coach of another group cannot save a scan for this person", !!(await save(stranger, client, group, values, null, false)).error);
      h.check("...nor read their scans", (await db.query(`select count(*)::int as n from public.body_scans`)).rows[0].n === 0);

      // the coach adds one
      await h.as(coach);
      const coachs = await save(coach, client2, group, { ...values, scanDate: "2026-09-01" }, `${group}/${client2}/c.jpg`, false);
      h.check("a coach of the group can save a scan for a client in it" + (coachs.error ? ": " + coachs.error : ""), !coachs.error);
      h.check("a coach cannot save for someone who is not in the group", !!(await save(coach, stranger, group, values, null, false)).error);
      h.check("the coach reads the client's scans", (await db.query(`select count(*)::int as n from public.body_scans where athlete_id = $1`, [client])).rows[0].n === 3);

      await h.as(client2);
      h.check("the client sees the scan their coach added", (await db.query(`select count(*)::int as n from public.body_scans where athlete_id = $1`, [client2])).rows[0].n === 1);
      h.check("...and does not see another client's scans", (await db.query(`select count(*)::int as n from public.body_scans where athlete_id = $1`, [client])).rows[0].n === 0);

      // delete
      await h.as(coach2);
      h.check("another coach (who did not add it) cannot delete the client's scan", (await db.query(`delete from public.body_scans where athlete_id = $1 returning id`, [client2])).rows.length === 0);
      await h.as(coach);
      h.check("the coach can delete a scan they added", (await db.query(`delete from public.body_scans where athlete_id = $1 returning id`, [client2])).rows.length === 1);
      h.check("...but not a scan the client added", (await db.query(`delete from public.body_scans where athlete_id = $1 returning id`, [client])).rows.length === 0);
      await h.as(client);
      h.check("a client can delete their own scans", (await db.query(`delete from public.body_scans where athlete_id = $1 returning id`, [client])).rows.length === 3);
      await h.asSuper();
      h.check("the other group has no scans", (await db.query(`select count(*)::int as n from public.body_scans where group_id = $1`, [group2])).rows[0].n === 0);
      h.check("the photo bucket is private", (await db.query(`select public from storage.buckets where id = 'inbody-scans'`)).rows[0]?.public === false);
    },
  },
};
