import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("image uploads: the look rules and the error text", () => {
  const sql = read("supabase/migrations/0320_storage_select_policies.sql");
  it("adds exactly one select rule per bucket, mirroring the write rule, and nothing else", () => {
    expect(sql.match(/create policy/g)?.length).toBe(3);
    expect(sql.match(/for select to authenticated/g)?.length).toBe(3);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/);
    expect(sql).toContain("om.role = any (array['owner'::public.org_member_role, 'admin'::public.org_member_role])");
    expect(sql).toContain("bucket_id = 'coach-profile-photos' and ((storage.foldername(name))[1])::uuid = (select auth.uid())");
    expect(sql).toContain("bucket_id = 'pro-shop-images' and ((storage.foldername(name))[1])::uuid = (select auth.uid())");
    expect(/[^\x00-\x7f]/.test(sql)).toBe(false);
  });
  it("the three upload screens no longer blame a switched account or show a raw database message", () => {
    const text = "Couldn't upload that image. Try again, or contact support if it keeps happening.";
    for (const f of ["components/coach/desktop/org-image-upload.tsx", "components/coach/coach-profile-editor.tsx", "components/coach/desktop/pro-shop-manager.tsx"]) {
      const src = read(f);
      expect(src, f).toContain(text);
      expect(src, f).not.toContain("setError(uploadError.message)");
      expect(src, f).toContain("console.error(");
    }
    expect(read("components/coach/desktop/org-image-upload.tsx")).not.toContain("switched accounts");
  });
});
