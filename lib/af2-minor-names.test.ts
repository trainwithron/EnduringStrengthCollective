import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveShowName } from "./share-name";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const year = new Date().getFullYear();
const adult = `${year - 30}-05-05`;
const teen = `${year - 15}-05-05`;

describe("a minor's name is never on a shared picture, whatever the switch says", () => {
  it("under 18 or an unknown age: off, even if the stored choice is on", () => {
    expect(resolveShowName(true, teen)).toBe(false);
    expect(resolveShowName(true, null)).toBe(false);
    expect(resolveShowName(true, undefined)).toBe(false);
    expect(resolveShowName(null, teen)).toBe(false);
    expect(resolveShowName(false, teen)).toBe(false);
  });

  it("an adult: their own choice wins, and with no choice yet it is on", () => {
    expect(resolveShowName(true, adult)).toBe(true);
    expect(resolveShowName(false, adult)).toBe(false);
    expect(resolveShowName(null, adult)).toBe(true);
  });

  it("the switch is not offered to someone who is not a confirmed adult", () => {
    const settings = src("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(settings).toContain('{!isCoach && showNameAvailable && ageStatusFromDob(ownDob) === "adult" && (');
  });
});

describe("full names of children are not handed to other athletes", () => {
  it("the expanded workout card returns the feed's protected name and no photo unless the viewer is the author or the group's coach", () => {
    const route = src("app/api/workout-share/[postId]/route.ts");
    expect(route).toContain("loadFeedProtectedIds([shared.authorId])");
    expect(route).toContain("protectAuthor(");
    const guard = route.lastIndexOf("if (!canShare) {");
    expect(guard).toBeGreaterThan(route.indexOf("canShare = membership?.role"));
    expect(route.indexOf("athleteName: author.fullName, athleteAvatarUrl: author.avatarUrl")).toBeGreaterThan(guard);
  });

  it("the group game leaderboard and the team game stat grid shorten names for non-coaches", () => {
    const games = src("app/(coach)/groups/[groupId]/games/[exerciseId]/page.tsx");
    expect(games).toContain("isCoach ? new Set<string>() : await loadNameProtectedIds(");
    expect(games).toContain("shownName(e.profiles?.full_name");
    const grid = src("app/(coach)/groups/[groupId]/team/calendar/games/[gameId]/page.tsx");
    expect(grid).toContain("isCoach ? new Set<string>() : await loadNameProtectedIds(");
    expect(grid).toContain("shownName(m.fullName");
  });

  it("the check-in kiosk shortens names for anyone who is not a confirmed adult and lists nobody until two letters are typed", () => {
    const page = src("app/(coach)/groups/[groupId]/kiosk/page.tsx");
    expect(page).toContain("loadNameProtectedIds(");
    expect(page).toContain("shownName(");
    const screen = src("components/coach/kiosk-checkin-screen.tsx");
    expect(screen).toContain("if (q.length < FRONT_DESK_MIN_QUERY) return [];");
    expect(screen).not.toContain("if (!q) return roster;");
    expect(screen).toContain("Type the first letters of your name.");
  });
});
