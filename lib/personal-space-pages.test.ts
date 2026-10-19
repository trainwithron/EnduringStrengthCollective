import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inOwnPersonalSpace } from "@/lib/personal-space";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const fake = (row: unknown, fail = false) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { if (fail) throw new Error("x"); return { data: row }; } }) }) }) }) as never;

// Oct 19 audit: the coach's own app said "This page is for clients" / "Ask your coach" on About you, My goal and My exercise history.
describe("the coach's own personal space", () => {
  it("is a group with no organization that the person created", async () => {
    expect(await inOwnPersonalSpace(fake({ organization_id: null, created_by: "me" }), "g", "me")).toBe(true);
  });
  it("not someone else's, not a real group with an organization, not when the read fails", async () => {
    expect(await inOwnPersonalSpace(fake({ organization_id: null, created_by: "other" }), "g", "me")).toBe(false);
    expect(await inOwnPersonalSpace(fake({ organization_id: "org", created_by: "me" }), "g", "me")).toBe(false);
    expect(await inOwnPersonalSpace(fake(null), "g", "me")).toBe(false);
    expect(await inOwnPersonalSpace(fake(null, true), "g", "me")).toBe(false);
  });
});

describe("the pages a client uses for themselves treat the coach as the client in their own space, and only there", () => {
  it("About you and My goal let them in", () => {
    for (const f of ["app/(coach)/groups/[groupId]/about-you/page.tsx", "app/(coach)/groups/[groupId]/goal/page.tsx"]) {
      expect(read(f), f).toContain('membership?.role !== "athlete" && !(await inOwnPersonalSpace(supabase, params.groupId, user.id))');
    }
  });
  it("My exercise history needs no enabling there and imports as a coach", () => {
    const p = read("app/(coach)/groups/[groupId]/my-history/page.tsx");
    expect(p).toContain('const ownSpace = membership?.role === "coach" && (await inOwnPersonalSpace(supabase, params.groupId, user.id));');
    expect(p).toContain("if (!ownSpace && (membership?.role !== \"athlete\" || !membership.history_import_enabled)) {");
    expect(p).toContain("viewerIsCoach={ownSpace}");
  });
  it("More and Settings show the client's links there", () => {
    const more = read("app/(coach)/groups/[groupId]/more/page.tsx");
    expect(more).toContain('isCoach: membership.role === "coach" && !ownSpace,');
    expect(more).toContain("historyImportEnabled: !!membership.history_import_enabled || ownSpace,");
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("((!isCoach && !effective.isActingAsOther) || inPersonalSpace) && (");
  });
  it("everything else still refuses a coach on a client page of a real group", () => {
    expect(read("app/(coach)/groups/[groupId]/about-you/page.tsx")).toContain("This page is for clients.");
  });
});
