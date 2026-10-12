import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Business totals: a coach counts their own, the owner or an admin counts the organization", () => {
  it("the scope lists every group of the organization only for an owner or admin of it", () => {
    const src = read("lib/business-scope.ts");
    expect(src).toContain('role !== "owner" && role !== "admin"');
    expect(src).toContain('.from("groups").select("id").eq("organization_id", orgId)');
    expect(src).toContain("organizationWide: true");
  });
  it("the Business page and the MRR number both read it, and the sessions count is not limited to the viewer's own sessions", () => {
    const page = read("app/(coach)/groups/[groupId]/business/page.tsx");
    expect(page).toContain("loadBusinessScope(supabase, user.id, params.groupId)");
    expect(page).toContain("scope.organizationWide ? {} : { coach_id: user.id }");
    expect(read("lib/coach-mrr.ts")).toContain("loadBusinessScope(supabase, coachId, groupId)");
  });
});
