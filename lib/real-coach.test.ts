import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRealCoach } from "@/lib/real-coach";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const fake = (rows: unknown[]) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: rows }) }) }) }) }) });

describe("a public page needs a real coach", () => {
  it("someone who coaches a group is a coach; someone who does not is not", async () => {
    expect(await isRealCoach(fake([{ group_id: "g" }]), "u")).toBe(true);
    expect(await isRealCoach(fake([]), "u")).toBe(false);
  });
  it("the coach's public page and the public booking page both answer 'not available' otherwise", () => {
    expect(read("app/c/[slug]/page.tsx")).toContain("if (!(await isRealCoach(db, page.coach_id))) return null;");
    expect(read("lib/public-booking-store.ts")).toContain("if (!(await isRealCoach(db, data.coach_id))) return null;");
  });
  it("the database rule (migration 0330) requires coaching a group to create or change either page, and leaves reading and removing your own row alone", () => {
    const sql = read("supabase/migrations/0330_public_page_coach_only.sql");
    expect(sql.match(/gm\.role = 'coach'/g)?.length).toBe(2);
    expect(sql).toContain("using (coach_id = (select auth.uid()))");
  });
});
