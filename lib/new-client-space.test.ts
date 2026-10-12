import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Adding a client: the creator of a new group seats themselves", () => {
  const sql = read("supabase/migrations/0360_new_group_creator_can_seat_themselves.sql");
  it("the new clause is narrow: own row, coach role, creator of a group that has no members yet", () => {
    expect(sql).toContain("g.created_by = auth.uid()");
    expect(sql).toContain("not exists (select 1 from public.group_memberships gm where gm.group_id = g.id)");
    expect(sql).toContain("and role = 'coach'\n      and public.group_is_new_and_mine(group_id)");
    expect(sql).toContain("profile_id = (select auth.uid())");
  });
  it("the screens that make a group and then seat their creator still do exactly that (the database rule is the fix)", () => {
    expect(read("components/coach/desktop/add-client-button.tsx")).toContain('from("group_memberships").insert({ group_id: newGroupId, profile_id: user.id, role: "coach" })');
    expect(read("components/coach/desktop/group-switcher.tsx")).toContain('role: "coach"');
  });
});
