// 0382: closures for minors and health data. A child or a person with no birthdate is not shown to other members of their organization and cannot switch their profile to visible; partner text is limited and requests are
// rate-limited; a parent link's secret is made by the database and needs verified consent; weigh-ins are believable; the scan bucket takes images only; saving a scan is bounded; a new notification type exists.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0382 Minors and health closures",
  migrations: ["0382"],
  phases: {
    async "0382"({ db, h }) {
      const coach = await h.user("MH Coach");
      const adult = await h.user("MH Adult");
      const adult2 = await h.user("MH Adult Two");
      const kid = await h.user("MH Kid");
      const unknown = await h.user("MH No Birthdate");
      const young = await h.user("MH Under Thirteen");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "MH team");
      for (const p of [adult, adult2, kid, unknown, young]) await h.member(g, p);
      await h.asSuper();
      const intake = (athlete, dob) => db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, ${dob})`, [athlete, g]);
      await intake(adult, "current_date - interval '30 years'");
      await intake(adult2, "current_date - interval '28 years'");
      await intake(kid, "current_date - interval '15 years'");
      await intake(young, "current_date - interval '10 years'");
      // 'unknown' has no intake row at all

      // 1. training partners
      for (const p of [adult, adult2, kid, unknown]) {
        await db.query(`insert into public.training_partner_profiles (athlete_id, visible, location_text) values ($1, true, 'gym') on conflict (athlete_id) do update set visible = true`, [p]);
      }
      await h.as(adult2);
      const seen = (await db.query(`select athlete_id from public.training_partner_profiles where visible = true and athlete_id <> $1`, [adult2])).rows.map((r) => r.athlete_id);
      h.check("an adult in the organization is still shown to another adult", seen.includes(adult));
      h.check("a 15-year-old is NOT shown to an adult in the same organization", !seen.includes(kid));
      h.check("a person with no birthdate on file is NOT shown either", !seen.includes(unknown));
      await h.as(kid);
      const seenByKid = (await db.query(`select athlete_id from public.training_partner_profiles where visible = true and athlete_id <> $1`, [kid])).rows;
      h.check("a 15-year-old is not shown anyone else's profile", seenByKid.length === 0);
      await h.as(young);
      const w = await tryQ(db, `insert into public.training_partner_profiles (athlete_id, visible) values ($1, true)`, [young]);
      h.check("a child cannot turn their own profile visible", !!w.error);
      const hidden = await tryQ(db, `insert into public.training_partner_profiles (athlete_id, visible) values ($1, false)`, [young]);
      h.check("but can keep a hidden one" + (hidden.error ? ": " + hidden.error : ""), !hidden.error);
      await h.as(adult2);
      const reqKid = await tryQ(db, `insert into public.training_partner_requests (from_athlete_id, to_athlete_id, message) values ($1, $2, 'hi')`, [adult2, kid]);
      h.check("an adult cannot send a partner request to a 15-year-old", !!reqKid.error);
      const reqAdult = await tryQ(db, `insert into public.training_partner_requests (from_athlete_id, to_athlete_id, message) values ($1, $2, 'hi')`, [adult2, adult]);
      h.check("an adult can send one to another adult" + (reqAdult.error ? ": " + reqAdult.error : ""), !reqAdult.error);
      const longMsg = await tryQ(db, `insert into public.training_partner_requests (from_athlete_id, to_athlete_id, message) values ($1, $2, repeat('x', 501))`, [adult2, adult]);
      h.check("a 501-character message is refused", !!longMsg.error);
      // a person can ask each other person once, so ten more distinct adults are made to ask
      const others = [];
      for (let i = 0; i < 12; i++) {
        const p = await h.user("MH Extra Adult " + i);
        await h.member(g, p);
        await h.asSuper();
        await db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, current_date - interval '30 years')`, [p, g]);
        others.push(p);
      }
      await h.as(adult2);
      let blocked = null;
      let sent = 1; // the request to the first adult above
      for (const p of others) {
        const r = await tryQ(db, `insert into public.training_partner_requests (from_athlete_id, to_athlete_id, message) values ($1, $2, 'again')`, [adult2, p]);
        if (r.error) { blocked = r.error; break; }
        sent++;
      }
      h.check("exactly ten requests are allowed in an hour (" + sent + " went through)", sent === 10);
      h.check("after ten requests in an hour the next is refused with a plain message", /most partner requests/i.test(blocked ?? ""), String(blocked));

      // 2. parent links
      await h.as(coach);
      const noConsent = await tryQ(db, `insert into public.guardian_links (athlete_id, group_id, created_by) values ($1, $2, $3)`, [young, g, coach]);
      h.check("a parent link needs verified parental consent first", !!noConsent.error);
      await h.asSuper();
      await db.query(`insert into public.minor_consent (athlete_id, group_id, verified) values ($1, $2, true)`, [young, g]);
      await h.as(coach);
      const withConsent = await tryQ(db, `insert into public.guardian_links (athlete_id, group_id, created_by, access_token) values ($1, $2, $3, 'chosen-by-the-browser') returning access_token`, [young, g, coach]);
      h.check("once consent is verified the link can be made" + (withConsent.error ? ": " + withConsent.error : ""), !withConsent.error);
      h.check("its secret is made by the database, whatever the browser sent (64 hex characters)", /^[0-9a-f]{64}$/.test(withConsent.rows?.[0]?.access_token ?? ""));

      // 3. weights, bucket, scans
      await h.asSuper();
      for (const wt of [0, 5, 2000]) {
        h.check(`a weigh-in of ${wt} is refused`, !!(await tryQ(db, `insert into public.body_weight_logs (athlete_id, group_id, logged_date, weight) values ($1, $2, current_date - ${wt === 0 ? 1 : wt === 5 ? 2 : 3}, $3)`, [adult, g, wt])).error);
      }
      h.check("a normal weigh-in is fine", !(await tryQ(db, `insert into public.body_weight_logs (athlete_id, group_id, logged_date, weight) values ($1, $2, current_date - 10, 180)`, [adult, g])).error);
      const bucket = await tryQ(db, `select allowed_mime_types from storage.buckets where id = 'inbody-scans'`, []);
      if (bucket.rows?.length) h.check("the scan photo bucket takes images only", JSON.stringify(bucket.rows[0].allowed_mime_types) === JSON.stringify(["image/jpeg", "image/png", "image/webp"]));
      await h.as(adult);
      const call = (values) => tryQ(db, `select public.save_body_scan($1, $2, $3::jsonb, null, false)`, [g, adult, JSON.stringify(values)]);
      h.check("a normal scan saves", !(await call({ scanDate: "2026-01-05", weightLb: 180 })).error);
      h.check("a scan dated before 2000 is refused", !!(await call({ scanDate: "1980-01-01", weightLb: 180 })).error);
      h.check("a scan with a 5000 lb weight is refused", !!(await call({ scanDate: "2026-01-06", weightLb: 5000 })).error);
      h.check("an oversized scan is refused", !!(await call({ scanDate: "2026-01-07", weightLb: 180, segments: { a: "x".repeat(9000) } })).error);

      // 4. the new notification type
      await h.asSuper();
      const note = await tryQ(db, `insert into public.notifications (profile_id, group_id, type, body, link_path) values ($1, $2, 'minor_consent_needed', 'x', '/') returning id`, [coach, g]);
      h.check("the notification type exists" + (note.error ? ": " + note.error : ""), !note.error);
      h.check("an unknown type is still refused", !!(await tryQ(db, `insert into public.notifications (profile_id, group_id, type, body, link_path) values ($1, $2, 'nonsense', 'x', '/')`, [coach, g])).error);
    },
  },
};
