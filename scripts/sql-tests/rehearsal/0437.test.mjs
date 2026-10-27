// 0437 Share pictures carry the coach: coach_booking_pages gets instagram_handle (1 to 30 letters, digits, "." and "_", no "@") and share_card_qr (on by default). The table's one row rule
// covers them: a coach changes only their own row; another person can neither read nor change it.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0437 Share pictures: Instagram handle and the QR switch",
  migrations: ["0437"],
  phases: {
    // The state just before 0437: a coach with a public page made before the step.
    async "0436"({ db, h, state }) {
      const coach = await h.user("SC Coach");
      const org = await h.org(coach, "SC Gym");
      await h.group(org, coach, "team", "SC Team");
      const other = await h.user("SC Other Coach");
      const org2 = await h.org(other, "SC Other Gym");
      await h.group(org2, other, "team", "SC Other Team");
      await h.asSuper();
      await db.query("insert into public.coach_booking_pages (coach_id, slug, enabled) values ($1, 'sc-coach', true)", [coach]);
      Object.assign(state, { coach, other });
    },
    async "0437"({ db, h, state }) {
      const row = await h.one("select instagram_handle, share_card_qr from public.coach_booking_pages where coach_id = $1", [state.coach]);
      h.check("a page made before the step has no handle and the QR switch on", row.instagram_handle === null && row.share_card_qr === true, JSON.stringify(row));

      await h.as(state.coach);
      const good = await tryQ(db, "update public.coach_booking_pages set instagram_handle = 'coach.ron_1' where coach_id = $1 returning instagram_handle", [state.coach]);
      h.check("the coach saves a handle of letters, digits, . and _", !good.error && good.rows?.[0]?.instagram_handle === "coach.ron_1", JSON.stringify(good));
      for (const bad of ["@coachron", "coach ron", "a".repeat(31), "", "coach-ron"]) {
        const r = await tryQ(db, "update public.coach_booking_pages set instagram_handle = $2 where coach_id = $1", [state.coach, bad]);
        h.check(`a handle like ${JSON.stringify(bad.length > 12 ? bad.slice(0, 12) + "..." : bad)} is refused`, !!r.error && /instagram_handle_format/.test(r.error), JSON.stringify(r));
      }
      const off = await tryQ(db, "update public.coach_booking_pages set share_card_qr = false, instagram_handle = null where coach_id = $1 returning share_card_qr, instagram_handle", [state.coach]);
      h.check("the coach switches the QR off and clears the handle", !off.error && off.rows?.[0]?.share_card_qr === false && off.rows?.[0]?.instagram_handle === null, JSON.stringify(off));
      const nullQr = await tryQ(db, "update public.coach_booking_pages set share_card_qr = null where coach_id = $1", [state.coach]);
      h.check("the switch is never empty", !!nullQr.error, JSON.stringify(nullQr));
      await h.asSuper();

      await h.as(state.other);
      const read = await tryQ(db, "select instagram_handle from public.coach_booking_pages where coach_id = $1", [state.coach]);
      const write = await tryQ(db, "update public.coach_booking_pages set instagram_handle = 'hijack' where coach_id = $1 returning coach_id", [state.coach]);
      await h.asSuper();
      h.check("another coach neither reads nor changes the row", (read.rows ?? []).length === 0 && (write.rows ?? []).length === 0, JSON.stringify({ read, write }));
      const after = await h.one("select instagram_handle from public.coach_booking_pages where coach_id = $1", [state.coach]);
      h.check("the row is as the coach left it", after.instagram_handle === null);

      const policies = await h.one("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages'");
      h.check("row security is unchanged: one rule", policies.n === 1);
    },
  },
};
