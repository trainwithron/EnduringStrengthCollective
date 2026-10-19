import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/coaches/signup/route.ts", "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: a "team or class" signup got the trimmed team menus but not the team features.
describe("a team or class signup", () => {
  it("switches on team mode on the starter group, only for that choice, after the organization exists", () => {
    expect(route).toContain('if (coachType === "team") {');
    expect(route).toContain('from("groups").update({ team_mode: true }).eq("id", groupId)');
    expect(route.indexOf('if (coachType === "team") {')).toBeGreaterThan(route.indexOf("organizationMade = true;"));
  });
  it("never fails the signup if that write fails", () => {
    expect(route).toContain("console.error(\"signup: couldn't switch on the team features:\"");
  });
});
