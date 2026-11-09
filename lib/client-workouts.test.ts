import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_WORKOUTS_PAGE, clientWorkoutsLimit, showClientWorkouts } from "@/lib/client-workouts";
import { mySpaceTarget, placeParams } from "@/lib/my-space-target";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron, Nov 9: the "19 new posts" notice opened Home and pointed at nothing.
describe("Client workouts on the Feed tab", () => {
  it("is what the tab opens on, and a link into the group feed still goes there", () => {
    expect(showClientWorkouts({})).toBe(true);
    expect(showClientWorkouts({ view: "clients", channel: "general" })).toBe(true);
    expect(showClientWorkouts({ view: "group" })).toBe(false);
    expect(showClientWorkouts({ channel: "pr_board" })).toBe(false);
    expect(showClientWorkouts({ highlight: "p1" })).toBe(false);
    expect(showClientWorkouts({ group: "g1" })).toBe(false);
  });
  it("only a coach gets it, never a client or a coach acting as a client", () => {
    expect(read("app/(coach)/groups/[groupId]/feed/page.tsx")).toContain("const coachSeesClients = !!user && (selfView || (isCoach && !isActingAsOther));");
  });
  it("keeps the page size sane", () => {
    expect(clientWorkoutsLimit(undefined)).toBe(CLIENT_WORKOUTS_PAGE);
    expect(clientWorkoutsLimit("abc")).toBe(CLIENT_WORKOUTS_PAGE);
    expect(clientWorkoutsLimit("100")).toBe(100);
    expect(clientWorkoutsLimit("99999")).toBe(500);
  });
  it("the notice's link survives the trip through the coach's own app", () => {
    const q = placeParams("feed", new URLSearchParams("view=clients"));
    expect(q.get("view")).toBe("client");
    expect(mySpaceTarget("space", q)).toBe("/groups/space/feed?view=clients");
    expect(mySpaceTarget("space", placeParams("feed", new URLSearchParams()))).toBe("/groups/space/feed");
  });
  it("counts one-on-one cards as workouts and opens the view", () => {
    const digest = read("app/api/cron/coach-digest/route.ts");
    expect(digest).toContain('hasClientWorkouts ? "/my-space/feed?view=clients" : "/dashboard"');
    expect(digest).toContain("p_group_ids: groupFeedIds");
  });
});
