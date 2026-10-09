// 0320: an upload adds a row and reads it back, so a bucket with a rule for adding but none for looking refused every upload. This proves that after the migration the owner's
// INSERT ... RETURNING works in each of the three buckets, and that another coach or a client still cannot write into (or read the rows of) someone else's folder.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0320 image upload look rules",
  migrations: ["0320"],
  phases: {
    async "0320"({ db, h }) {
      const owner = await h.user("UP Owner");
      const other = await h.user("UP Other Coach");
      const client = await h.user("UP Client");
      const org = await h.org(owner);
      const otherOrg = await h.org(other);
      await h.asSuper();
      // The scratch database does not switch row security on for storage.objects by itself; the real one does.
      await db.query("alter table storage.objects enable row level security");
      await db.query("grant select, insert, update, delete on storage.objects to authenticated");
      // The existing "add" rules (they exist live; make sure they are here too so the test mirrors production).
      const have = async (name) => (await h.rows("select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = $1", [name])).length > 0;
      if (!(await have("org_branding_insert_owner_admin"))) {
        await db.query(`create policy org_branding_insert_owner_admin on storage.objects for insert to authenticated with check (bucket_id = 'org-branding' and exists (select 1 from public.organization_memberships om where om.organization_id = ((storage.foldername(objects.name))[1])::uuid and om.profile_id = auth.uid() and om.role = any (array['owner'::public.org_member_role, 'admin'::public.org_member_role])))`);
      }
      for (const [bucket, name] of [["coach-profile-photos", "coach_profile_photos_insert_own"], ["pro-shop-images", "pro_shop_images_insert_own"]]) {
        if (!(await have(name))) {
          await db.query(`create policy ${name} on storage.objects for insert to authenticated with check (bucket_id = '${bucket}' and ((storage.foldername(name))[1])::uuid = auth.uid())`);
        }
      }

      const put = (bucket, path) => tryQ(db, "insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid()) returning id", [bucket, path]);

      await h.as(owner);
      const o1 = await put("org-branding", `${org}/logo.png`);
      h.check("the org owner's upload (insert and read back) works for the organization logo", !o1.error && o1.rows.length === 1, JSON.stringify(o1));
      const o2 = await put("coach-profile-photos", `${owner}/photo.png`);
      h.check("a coach's own profile photo upload works", !o2.error && o2.rows.length === 1, JSON.stringify(o2));
      const o3 = await put("pro-shop-images", `${owner}/shop.png`);
      h.check("a coach's own pro shop picture upload works", !o3.error && o3.rows.length === 1, JSON.stringify(o3));

      await h.as(other);
      const x1 = await put("org-branding", `${org}/logo2.png`);
      h.check("another coach cannot write into someone else's organization folder", !!x1.error, JSON.stringify(x1));
      const x2 = await put("coach-profile-photos", `${owner}/photo2.png`);
      h.check("another coach cannot write into someone else's profile photo folder", !!x2.error, JSON.stringify(x2));
      const seen = await tryQ(db, "select count(*)::int as n from storage.objects where bucket_id in ('org-branding', 'coach-profile-photos', 'pro-shop-images')", []);
      h.check("and cannot look at the rows of those folders", !seen.error && seen.rows[0].n === 0, JSON.stringify(seen));

      await h.as(client);
      const c1 = await put("pro-shop-images", `${owner}/shop2.png`);
      h.check("a client cannot write into a coach's pro shop folder", !!c1.error, JSON.stringify(c1));
      const cseen = await tryQ(db, "select count(*)::int as n from storage.objects", []);
      h.check("and sees none of the rows", !cseen.error && cseen.rows[0].n === 0, JSON.stringify(cseen));
    },
  },
};
