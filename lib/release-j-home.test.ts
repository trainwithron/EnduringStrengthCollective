import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COACH_PHONE_LANDING, pickFeedGroup, startPath } from "./start-group";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("where a person lands", () => {
  const coach = { group_id: "g1", role: "coach" };
  const client = { group_id: "g2", role: "athlete" };
  it("a coach on a phone opens on their own client profile; at a computer, the desktop Home", () => {
    expect(startPath(coach, true)).toBe(COACH_PHONE_LANDING);
    expect(COACH_PHONE_LANDING).toBe("/my-space?view=client");
    expect(startPath(coach, false)).toBe("/dashboard");
  });
  it("a client goes to their group whatever the device, and nobody with no group goes to the front page", () => {
    expect(startPath(client, true)).toBe("/groups/g2");
    expect(startPath(client, false)).toBe("/groups/g2");
    expect(startPath(null, true)).toBe("/");
  });
  it("login, the front page and the email-confirmed page all use the same rule", () => {
    for (const f of ["app/login/page.tsx", "app/page.tsx", "app/confirm-email/page.tsx"]) expect(src(f), f).toContain("startPath(");
  });
});

describe("the coach's own client app", () => {
  it("the feed is one group at a time: the one named, else the last one worked in, else the first by name", () => {
    const groups = [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }, { id: "c", name: "Gamma" }];
    expect(pickFeedGroup(groups, "c", "b")?.id).toBe("c");
    expect(pickFeedGroup(groups, "not mine", "b")?.id).toBe("b");
    expect(pickFeedGroup(groups, undefined, undefined)?.id).toBe("a");
    expect(pickFeedGroup([], "a", "b")).toBeNull();
  });

  it("the feed page lists only shared groups, keeps the coach's own space in the address, and never offers a one-on-one space", () => {
    const page = src("app/(coach)/groups/[groupId]/feed/page.tsx");
    expect(page).toContain('.filter((g) => g.kind !== "one_on_one")');
    expect(page).toContain("const selfView = isActingAsOther && !!user && athleteId === user.id;");
    expect(page).toContain("FeedGroupPicker");
    expect(page).not.toContain('.eq("group_id", params.groupId)\n      .eq("channel"');
    expect(src("components/feed/feed-group-picker.tsx")).toContain("/feed?group=");
    expect(src("components/feed/channel-tabs.tsx")).toContain('basePath.includes("?")');
  });

  it("the bar names Me or the client with a dropdown to pick another, carries the Spot button, and the client glance tiles are for a client only", () => {
    const bar = src("components/athlete/acting-as-banner.tsx");
    expect(bar).toContain('self ? "Me" : athleteFullName');
    expect(bar).toContain("<CoachSpotHub");
    expect(bar).toContain("Coach home");
    expect(src("app/(coach)/groups/[groupId]/page.tsx")).toContain("isActingAsOther && athleteId !== user?.id && (");
  });
});
