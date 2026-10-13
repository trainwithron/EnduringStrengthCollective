// 0362: every storage bucket lists the file types its screen uploads (the storage service refuses anything else), post-media gets a size limit, and the signed-out role has no rights on coach_sites.
export default {
  name: "0362 storage buckets accept only the file types their screens upload",
  migrations: ["0362"],
  phases: {
    async "0362"({ db, h }) {
      await h.asSuper();
      const buckets = (await db.query("select id, public, allowed_mime_types, file_size_limit from storage.buckets")).rows;
      const byId = Object.fromEntries(buckets.map((b) => [b.id, b]));
      h.check("there are buckets to check", buckets.length > 0);
      for (const [id, b] of Object.entries(byId)) {
        h.check(`bucket ${id} (${b.public ? "public" : "private"}) has a file-type list`, Array.isArray(b.allowed_mime_types) && b.allowed_mime_types.length > 0);
      }
      for (const id of ["coach-profile-photos", "pro-shop-images", "org-branding"]) {
        if (!byId[id]) continue;
        const types = byId[id].allowed_mime_types ?? [];
        h.check(`public bucket ${id} takes images only`, types.every((t) => t.startsWith("image/")));
        h.check(`public bucket ${id} does not take HTML, scripts or executables`, !types.some((t) => /html|javascript|octet-stream|x-msdownload|pdf/.test(t)));
      }
      if (byId["waiver-documents"]) h.check("waiver documents take PDF only", JSON.stringify(byId["waiver-documents"].allowed_mime_types) === JSON.stringify(["application/pdf"]));
      if (byId["post-media"]) h.check("post-media has a size limit", Number(byId["post-media"].file_size_limit) === 104857600);
      const anonRights = (await db.query("select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'coach_sites' and grantee = 'anon'")).rows[0].n;
      h.check("the signed-out role has no rights on coach_sites", anonRights === 0);
    },
  },
};
