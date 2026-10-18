import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGroupMemberNames, readPositionRoster } from "./group-roster-reads";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// A stand-in client: the function answers (or is missing, or fails), and the older direct read answers too.
function client(opts: { rpc: { data?: unknown; error?: { code?: string; message?: string } | null }; direct?: unknown[] }) {
  const direct = { data: opts.direct ?? [], error: null };
  const chain: any = { select: () => chain, eq: () => chain, then: (r: (v: unknown) => void) => r(direct) };
  return { rpc: async () => ({ data: opts.rpc.data ?? null, error: opts.rpc.error ?? null }), from: () => chain } as never;
}

describe("who else is in the group, as an athlete's screen asks it", () => {
  it("uses the narrow function and keeps only id, name, photo and role", async () => {
    const out = await readGroupMemberNames(client({ rpc: { data: [{ profile_id: "a", full_name: "Ann A", avatar_url: null, role: "athlete" }, { profile_id: "b", full_name: null, avatar_url: null, role: "athlete" }] } }), "g");
    expect(out).toEqual([{ id: "a", fullName: "Ann A", avatarUrl: null, role: "athlete" }]);
  });

  it("before the function exists it falls back to the older read, so deploying the code first changes nothing", async () => {
    const out = await readGroupMemberNames(client({ rpc: { error: { code: "PGRST202", message: "Could not find the function public.group_member_names" } }, direct: [{ profile_id: "a", role: "coach", profiles: { full_name: "Pat Coach", avatar_url: "x" } }] }), "g");
    expect(out).toEqual([{ id: "a", fullName: "Pat Coach", avatarUrl: "x", role: "coach" }]);
  });

  it("any other failure shows nobody rather than guessing", async () => {
    expect(await readGroupMemberNames(client({ rpc: { error: { code: "XX000", message: "boom" } }, direct: [{ profile_id: "a", role: "athlete", profiles: { full_name: "No" } }] }), "g")).toEqual([]);
    expect(await readPositionRoster(client({ rpc: { error: { code: "XX000", message: "boom" } } }), "g")).toBeNull();
  });

  it("the position roster carries a name, how they share, and the position, and nothing else", async () => {
    const out = await readPositionRoster(client({ rpc: { data: [{ profile_id: "a", full_name: "Ann A", feed_broadcast_level: "full", position_id: "p", position_name: "Linemen", position_sort_order: 2 }] } }), "g");
    expect(out).toEqual([{ profileId: "a", fullName: "Ann A", feedBroadcastLevel: "full", positionId: "p", positionName: "Linemen", positionSortOrder: 2 }]);
  });
});

describe("the athlete screens use the narrow reads", () => {
  it("the @mention lists, the position leaderboard and the game stat grid no longer read other people's membership rows", () => {
    expect(src("lib/use-mention-autocomplete.ts")).toContain("readGroupMemberNames(supabase, groupId)");
    expect(src("components/feed/inline-comment-section.tsx")).toContain("readGroupMemberNames(supabase, post.group_id)");
    expect(src("lib/leaderboard-data.ts")).toContain("readPositionRoster(supabase, groupId)");
    expect(src("app/(coach)/groups/[groupId]/team/calendar/games/[gameId]/page.tsx")).toContain("readPositionRoster(supabase, params.groupId)");
    // none of the four selects a membership row of another person any more
    for (const f of ["lib/use-mention-autocomplete.ts", "lib/leaderboard-data.ts"]) {
      expect(src(f)).not.toContain('.from("group_memberships")');
    }
  });

  it("the migration adds two member-only read functions and nothing else", () => {
    const sql = src("supabase/migrations/0404_athlete_narrow_reads.sql")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql.match(/create or replace function public\./g)!.length).toBe(2);
    // a member, or the group's organization owner/admin (with the private-client rule), and nobody else
    expect(sql.match(/if not v_member and not public\.is_org_admin_of_group\(p_group\) then/g)!.length).toBe(2);
    expect(sql.match(/v_member := public\.is_group_member\(p_group\);/g)!.length).toBe(2);
    expect(sql.match(/is_client_private_from_org/g)!.length).toBeGreaterThanOrEqual(2);
    // none of the sensitive columns is returned (the private-client RULE is applied through a function, not by returning the column)
    expect(sql).not.toMatch(/client_tier|training_level|membership_type|m\.private_from_org/);
  });
});
