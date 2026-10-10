import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildShareImageModel } from "@/lib/share-image";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("first name on shared workout pictures (Release AL)", () => {
  it("the column is on for everyone by default and nothing else is touched", () => {
    const sql = read("supabase/migrations/0334_share_name_setting.sql");
    expect(sql).toContain("add column if not exists show_name_on_share boolean not null default true");
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
    expect(src).toContain("const nameHidden = !opts.fullName && authorProfile?.show_name_on_share === false;");
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
