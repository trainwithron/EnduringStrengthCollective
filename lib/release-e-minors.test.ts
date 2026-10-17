import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shownName } from "@/lib/shown-name";
import { onSharedBoards } from "@/lib/board-visibility";
import { isStoredLink, mayViewChallengePhotos } from "@/lib/challenge-photo";
import { resolveShowName } from "@/lib/share-name";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("a member under 18 is shown as first name and last initial on shared boards", () => {
  it("shortens a minor, leaves an adult, and shortens everyone if the age lookup failed", () => {
    expect(shownName("Sam Rivera", "m1", new Set(["m1"]))).toBe("Sam R.");
    expect(shownName("Alex Jones", "a1", new Set(["m1"]))).toBe("Alex Jones");
    expect(shownName("Alex Jones", "a1", new Set(["*"]))).toBe("Alex J.");
    expect(shownName(null, "a1", new Set())).toBe("Unknown");
  });
  it("a member who keeps their numbers private, or shares only that they checked in, is not ranked", () => {
    expect(onSharedBoards("full")).toBe(true);
    expect(onSharedBoards("prs_only")).toBe(true);
    expect(onSharedBoards(null)).toBe(true);
    expect(onSharedBoards("private")).toBe(false);
    expect(onSharedBoards("checkin_only")).toBe(false);
  });
  it("the leaderboard, the records board and a challenge use them", () => {
    const lb = src("lib/leaderboard-data.ts");
    expect(lb).toContain("if (!onSharedBoards((log.profiles as any)?.feed_broadcast_level)) continue;");
    expect(lb).toContain("shownName(");
    expect(lb).toContain(".filter((m: any) => onSharedBoards(m.profiles?.feed_broadcast_level))");
    expect(src("app/(coach)/groups/[groupId]/records/page.tsx")).toContain("shownName(row.profiles.full_name, row.athlete_id, minors)");
    expect(src("app/(coach)/groups/[groupId]/challenges/[challengeId]/page.tsx")).toContain("shownName((p.profiles as any)?.full_name, p.profile_id, minors)");
  });
});

describe("the live leaderboard (a browser screen) never reaches for the server-only age lookup", () => {
  it("the lookup runs on the server and its result is handed down", () => {
    expect(src("lib/leaderboard-data.ts")).not.toContain(`from "@/lib/minor-names"`);
    expect(src("components/leaderboard/live-group-leaderboard.tsx")).not.toContain(`from "@/lib/minor-names"`);
    expect(src("components/leaderboard/live-group-leaderboard.tsx")).toContain("new Set(minorIds)");
    expect(src("app/(coach)/groups/[groupId]/feed/page.tsx")).toContain("minorIds={Array.from(minors)}");
  });
});

describe("a shared picture protects someone whose age is not known", () => {
  const asOf = new Date("2026-10-11T12:00:00");
  it("the name is hidden by default under 18 AND when there is no date of birth; a choice always wins", () => {
    expect(resolveShowName(null, null, asOf)).toBe(false);
    expect(resolveShowName(null, "2012-05-05", asOf)).toBe(false);
    expect(resolveShowName(null, "1985-03-03", asOf)).toBe(true);
    expect(resolveShowName(true, null, asOf)).toBe(true);
  });
  it("the photo is hidden whenever the name is", () => {
    expect(src("lib/shared-workout.ts")).toContain("athleteAvatarUrl: nameHidden ? null :");
  });
});

describe("challenge photos", () => {
  it("only the person and the challenge's coach may open a photo; the stored value is a path, never a year-long link", () => {
    expect(mayViewChallengePhotos("p1", "p1", "c1")).toBe(true);
    expect(mayViewChallengePhotos("c1", "p1", "c1")).toBe(true);
    expect(mayViewChallengePhotos("p2", "p1", "c1")).toBe(false);
    expect(isStoredLink("https://x/y.png")).toBe(true);
    expect(isStoredLink("g/challenges/c/u-before.png")).toBe(false);
    const panel = src("components/athlete/challenge-participant-panel.tsx");
    expect(panel).toContain("[column]: path");
    expect(panel).not.toContain("createSignedUrl(path, 60 * 60 * 24 * 365)");
  });
});

describe("Find a coach", () => {
  it("lists a coach only when they turned it on themselves, under their chosen name or first name and last initial", () => {
    const b = src("lib/marketplace-browse.ts");
    expect(b).toContain("if (!row.profiles?.marketplace_listed) continue;");
    expect(b).toContain("publicDisplayName(row.profiles?.full_name)");
    expect(src("app/(coach)/groups/[groupId]/branding/page.tsx")).toContain("<MarketplacePersonControl");
    expect(src("supabase/migrations/0387_minors_off_public_surfaces.sql")).toContain("marketplace_listed boolean not null default false");
  });
});
