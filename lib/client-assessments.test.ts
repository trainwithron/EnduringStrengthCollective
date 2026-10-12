import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathBelongsToPerson } from "@/lib/account-deletion";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("coach assessments", () => {
  it("are on the client's Forms and notes tab and are the coach's own", () => {
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain("<ClientAssessmentsSection");
    const ui = read("components/coach/desktop/client-assessments.tsx");
    expect(ui).toContain(">Assessments</h2>");
    expect(ui).toContain("Attach a file");
    expect(ui).not.toContain("Numbers");
  });
  it("only the coaches of the group read the table and the files", () => {
    const sql = read("supabase/migrations/0355_client_assessments.sql");
    expect(sql).toContain('create policy "client_assessments_coach_manage"');
    expect(sql).toContain("public.is_group_coach((storage.foldername(name))[1]::uuid)");
    expect(sql).not.toContain("is_org_admin_of_group");
  });
  it("a deleted client's assessment files are removed with them, and only from their own folder", () => {
    expect(read("lib/account-deletion.ts")).toContain('bucket: "client-assessments"');
    expect(pathBelongsToPerson("client-assessments", "g1/u1/f.pdf", "u1")).toBe(true);
    expect(pathBelongsToPerson("client-assessments", "g1/u2/f.pdf", "u1")).toBe(false);
  });
});
