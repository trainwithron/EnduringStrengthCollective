// 0434 The platform demo library: the demos on a platform admin's exercises are readable by every signed-in person (the demo fields only, and exactly those video files); nothing
// else of the admin's library leaks, signed-out visitors get nothing, and nobody can upload into or delete from the admin's folder.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0434 Platform demo library: demo fields and demo videos for every signed-in person, nothing else",
  migrations: ["0434"],
  phases: {
    async "0434"({ db, h }) {
      const admin = await h.platformAdmin("PD Admin");
      const owner = await h.user("PD Other Owner");
      const coach = await h.user("PD Other Coach");
      const client = await h.user("PD Other Client");
      const org = await h.org(owner, "PD Gym");
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, coach, "team", "PD Team");
      await h.member(g, client);
      await h.asSuper();
      // The scratch database does not switch row security on for storage.objects by itself; the real one does.
      await db.query("alter table storage.objects enable row level security");
      await db.query("grant select, insert, update, delete on storage.objects to authenticated, anon");

      const video = `${admin}/squat.mp4`;
      const stray = `${admin}/not-a-demo.mp4`;
      await db.query("insert into public.exercise_library (created_by, name, video_path) values ($1, 'Goblet Squat', $2)", [admin, video]);
      await db.query("insert into public.exercise_library (created_by, name, youtube_url) values ($1, 'Farmer Carry', 'https://youtu.be/abcdefghijk')", [admin]);
      await db.query("insert into public.exercise_library (created_by, name, description) values ($1, 'Secret Admin Drill', 'private notes')", [admin]);
      await db.query("insert into public.exercise_library (created_by, name, youtube_url) values ($1, 'Coach Own Row', 'https://youtu.be/zzzzzzzzzzz')", [coach]);
      await db.query("insert into storage.objects (bucket_id, name, owner) values ('exercise-media', $1, $2), ('exercise-media', $3, $2)", [video, admin, stray]);

      const as = async (who, sql, params) => {
        await h.as(who);
        const r = await tryQ(db, sql, params);
        await h.asSuper();
        return r;
      };

      // ---- the read function: demo rows only, demo fields only, signed-in only
      for (const [who, label] of [[coach, "a coach of another organization"], [client, "a client of another coach"]]) {
        const r = await as(who, "select * from public.platform_demo_rows()");
        const names = (r.rows ?? []).map((x) => x.name).sort();
        h.check(`${label} reads the two platform demos and nothing else`, !r.error && JSON.stringify(names) === JSON.stringify(["Farmer Carry", "Goblet Squat"]), JSON.stringify(r));
        h.check(`${label}: only name, video and link come back`, !r.error && Object.keys(r.rows[0]).sort().join(",") === "name,video_path,youtube_url", JSON.stringify(r.rows?.[0]));
      }
      const anonFn = await as(null, "select * from public.platform_demo_rows()");
      h.check("a signed-out visitor cannot call it", /permission denied/.test(anonFn.error ?? ""), JSON.stringify(anonFn));
      const notAdminRows = await as(coach, "select count(*)::int as n from public.platform_demo_rows() where name = 'Coach Own Row'");
      h.check("a non-admin coach's demos are not platform demos", notAdminRows.rows?.[0]?.n === 0, JSON.stringify(notAdminRows));

      // ---- exercise_library itself is unchanged: the admin's rows (the demo-less one included) stay private
      const direct = await as(coach, "select name from public.exercise_library where created_by = $1", [admin]);
      h.check("another coach still cannot read the admin's library rows", !direct.error && direct.rows.length === 0, JSON.stringify(direct));

      // ---- the files: exactly the demo videos, for signed-in people
      const seenByClient = await as(client, "select name from storage.objects where bucket_id = 'exercise-media'");
      h.check("a client of another coach can read the demo video (so a signed link works)", !seenByClient.error && seenByClient.rows.some((r) => r.name === video), JSON.stringify(seenByClient));
      h.check("a file in the admin's folder that is not a demo stays private", !seenByClient.error && !seenByClient.rows.some((r) => r.name === stray), JSON.stringify(seenByClient));
      const seenByAnon = await as(null, "select name from storage.objects where bucket_id = 'exercise-media'");
      h.check("a signed-out visitor sees no file", (seenByAnon.rows ?? []).length === 0 || /permission denied/.test(seenByAnon.error ?? ""), JSON.stringify(seenByAnon));
      const anonObj = await as(null, "select public.is_platform_demo_object($1) as v", [video]);
      h.check("a signed-out visitor cannot ask about files either", /permission denied/.test(anonObj.error ?? ""), JSON.stringify(anonObj));

      // ---- uploading and deleting are unchanged
      const upload = await as(coach, "insert into storage.objects (bucket_id, name, owner) values ('exercise-media', $1, auth.uid()) returning id", [`${admin}/planted.mp4`]);
      h.check("a non-admin coach cannot upload into the admin's folder", !!upload.error, JSON.stringify(upload));
      await as(coach, "delete from storage.objects where name = $1", [video]);
      const still = await h.one("select count(*)::int as n from storage.objects where name = $1", [video]);
      h.check("a non-admin coach cannot delete the admin's demo video", still.n === 1, JSON.stringify(still));
      const ownUpload = await as(coach, "insert into storage.objects (bucket_id, name, owner) values ('exercise-media', $1, auth.uid()) returning id", [`${coach}/mine.mp4`]);
      h.check("a coach still uploads into their own folder", !ownUpload.error, JSON.stringify(ownUpload));

      // ---- a demo the admin removes is no longer readable by others
      await db.query("update public.exercise_library set video_path = null where created_by = $1 and name = 'Goblet Squat'", [admin]);
      const after = await as(client, "select name from storage.objects where bucket_id = 'exercise-media' and name = $1", [video]);
      h.check("a video no longer on a platform demo is private again", !after.error && after.rows.length === 0, JSON.stringify(after));
    },
  },
};
