// 0438 A coach's Instagram handle moves to coach_profiles (the coach's own settings): any coach sets it, with or without a public page; a handle already on a page row is copied across, and
// coach_booking_pages.instagram_handle is dropped (one place). The table's rules (0196): the coach reads and changes their own row, their clients read it, nobody else sees it.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0438 Instagram handle in the coach's own settings",
  migrations: ["0438"],
  phases: {
    // Before 0438: one coach with a public page and a handle on it (0437), one coach with a page and no handle, one coach with no page at all.
    async "0437"({ db, h, state }) {
      const withHandle = await h.user("IG Page Coach");
      const org = await h.org(withHandle, "IG Gym");
      const team = await h.group(org, withHandle, "team", "IG Team");
      const plain = await h.user("IG Plain Coach");
      const org2 = await h.org(plain, "IG Plain Gym");
      await h.group(org2, plain, "team", "IG Plain Team");
      const noPage = await h.user("IG No Page Coach");
      const org3 = await h.org(noPage, "IG No Page Gym");
      await h.group(org3, noPage, "team", "IG No Page Team");
      const client = await h.user("IG Client");
      await h.member(team, client);
      const stranger = await h.user("IG Stranger");
      await h.asSuper();
      await db.query("insert into public.coach_booking_pages (coach_id, slug, enabled, instagram_handle) values ($1, 'ig-page-coach', true, 'page.coach')", [withHandle]);
      await db.query("insert into public.coach_booking_pages (coach_id, slug, enabled) values ($1, 'ig-plain-coach', true)", [plain]);
      // the page coach already has a coach_profiles row (a bio), so the copy updates it
      await db.query("insert into public.coach_profiles (coach_id, bio) values ($1, 'Strength coach')", [withHandle]);
      Object.assign(state, { withHandle, plain, noPage, client, stranger });
    },
    async "0438"({ db, h, state }) {
      const gone = await h.one("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'instagram_handle'");
      h.check("the page row's handle column is gone (one place)", gone.n === 0);
      const moved = await h.one("select instagram_handle, bio from public.coach_profiles where coach_id = $1", [state.withHandle]);
      h.check("a handle saved on a page row is copied to the coach's own settings, keeping the rest of the row", moved.instagram_handle === "page.coach" && moved.bio === "Strength coach", JSON.stringify(moved));
      const none = await h.one("select count(*)::int as n from public.coach_profiles where coach_id in ($1, $2)", [state.plain, state.noPage]);
      h.check("no row is made for a coach who had no handle", none.n === 0);
      const pages = await h.one("select count(*)::int as n, bool_and(enabled) as on from public.coach_booking_pages where coach_id in ($1, $2, $3)", [state.withHandle, state.plain, state.noPage]);
      h.check("no page is made, switched or removed", pages.n === 2 && pages.on === true, JSON.stringify(pages));

      // a coach with no public page saves, changes and clears a handle on their own row
      await h.as(state.noPage);
      const save = await tryQ(db, "insert into public.coach_profiles (coach_id, instagram_handle) values ($1, 'no.page_coach') on conflict (coach_id) do update set instagram_handle = excluded.instagram_handle returning instagram_handle", [state.noPage]);
      h.check("a coach with no public page saves a handle", !save.error && save.rows?.[0]?.instagram_handle === "no.page_coach", JSON.stringify(save));
      for (const bad of ["@nopage", "no page", "a".repeat(31), "", "no-page"]) {
        const r = await tryQ(db, "update public.coach_profiles set instagram_handle = $2 where coach_id = $1", [state.noPage, bad]);
        h.check(`a handle like ${JSON.stringify(bad.length > 12 ? bad.slice(0, 12) + "..." : bad)} is refused`, !!r.error && /instagram_handle_format/.test(r.error), JSON.stringify(r));
      }
      const cleared = await tryQ(db, "update public.coach_profiles set instagram_handle = null where coach_id = $1 returning instagram_handle", [state.noPage]);
      h.check("and clears it", !cleared.error && cleared.rows?.[0]?.instagram_handle === null, JSON.stringify(cleared));
      await h.asSuper();
      const noPageStill = await h.one("select count(*)::int as n from public.coach_booking_pages where coach_id = $1", [state.noPage]);
      h.check("saving a handle makes no public page", noPageStill.n === 0);

      // who reads and who changes the page coach's handle
      await h.as(state.client);
      const clientRead = await tryQ(db, "select instagram_handle from public.coach_profiles where coach_id = $1", [state.withHandle]);
      const clientWrite = await tryQ(db, "update public.coach_profiles set instagram_handle = 'hijack' where coach_id = $1 returning coach_id", [state.withHandle]);
      await h.asSuper();
      h.check("the coach's client reads it and cannot change it", clientRead.rows?.[0]?.instagram_handle === "page.coach" && (clientWrite.rows ?? []).length === 0, JSON.stringify({ clientRead, clientWrite }));
      await h.as(state.stranger);
      const strangerRead = await tryQ(db, "select instagram_handle from public.coach_profiles where coach_id = $1", [state.withHandle]);
      await h.asSuper();
      h.check("someone else does not see it", (strangerRead.rows ?? []).length === 0, JSON.stringify(strangerRead));

      const policies = await h.one("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'coach_profiles'");
      h.check("coach_profiles still has its two rules", policies.n === 2);
    },
  },
};
