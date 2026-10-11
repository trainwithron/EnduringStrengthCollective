import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildShareImageModel } from "@/lib/share-image";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("first name on shared workout pictures (Release AL)", () => {
  it("the column is on for everyone by default and nothing else is touched", () => {
    const sql = read("supabase/migrations/0334_share_name_setting.sql");
    expect(sql).toContain("add column if not exists show_name_on_share boolean;");
    expect(sql).not.toContain("not null");
    expect(sql).not.toMatch(/update public|delete from|drop /);
  });
  it("the client's own Settings has the switch with the approved wording, and no switch is on the card", () => {
    const settings = read("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(settings).toContain("<ShowNameOnShareToggle");
    expect(settings).toContain("showNameAvailable");
    expect(read("components/athlete/show-name-on-share-toggle.tsx")).toContain("Show my first name on shared workout pictures");
    expect(read("components/share/share-actions.tsx")).not.toMatch(/Name (on|off)/);
  });
  it("the public card and picture follow the setting, the group's own feed card does not", () => {
    const src = read("lib/shared-workout.ts");
    expect(src).toContain("const nameHidden = !opts.fullName && nameColumnThere && !resolveShowName(authorProfile?.show_name_on_share, authorDob);");
    expect(src).toContain('nameHidden\n      ? "An athlete"');
  });
  it("with no name the picture carries no name and no initial", () => {
    const model = buildShareImageModel({
      groupName: "G", athleteName: "An athlete", showName: true, prCount: 0, totalVolume: 1000, totalSets: 5, durationSeconds: 1800, topLifts: [], weekStreak: 0,
      totalWorkoutCount: 3, createdAt: "2026-10-01T12:00:00Z", background: null,
    });
    expect(model.name).toBeNull();
    expect(read("app/share/[postId]/page.tsx")).toContain('const mascotInitial = shared.athleteName === "An athlete" ? null : shared.athleteName;');
  });
});

describe("a one-on-one space's name (the client's full name) never reaches the public card", () => {
  it("the public card, picture and link preview use the business name for a one-on-one space", () => {
    const src = read("lib/shared-workout.ts");
    expect(src).toContain('.select("name, organization_id, group_kind")');
    expect(src).toContain('.select("name, workout_card_background_mode, workout_card_background_url")');
    expect(src).toContain('!opts.fullName && (group as { group_kind?: string } | null)?.group_kind === "one_on_one"');
    expect(src).toContain('?? "Spotlight Coaching"');
  });
});

import { resolveShowName } from "@/lib/share-name";

describe("the default depends on age until the client chooses (Ron's decision)", () => {
  const asOf = new Date("2026-10-11T12:00:00");
  it("a client's own choice always wins", () => {
    expect(resolveShowName(true, "2015-01-01", asOf)).toBe(true);
    expect(resolveShowName(false, "1990-01-01", asOf)).toBe(false);
  });
  it("no choice yet: off under 18, on for an adult, on when there is no date of birth", () => {
    expect(resolveShowName(null, "2012-05-05", asOf)).toBe(false);
    expect(resolveShowName(undefined, "2009-10-12", asOf)).toBe(false); // turns 18 tomorrow
    expect(resolveShowName(null, "2008-10-11", asOf)).toBe(true); // turns 18 today
    expect(resolveShowName(null, "1985-03-03", asOf)).toBe(true);
    expect(resolveShowName(null, null, asOf)).toBe(true);
    expect(resolveShowName(null, "not a date", asOf)).toBe(true);
  });
  it("the settings page shows the same default the card uses", () => {
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("resolveShowName(");
  });
});
