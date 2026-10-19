import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Ron's rule (Oct 19): the team features are hidden by default. The signup choice is "A team or a class" (one answer), so it cannot tell a sports team from a yoga class: nothing is switched on at signup, and the coach turns
// "Team sport" on in the group's Settings.
it("coach signup does not switch team mode on", () => {
  expect(readFileSync("app/api/coaches/signup/route.ts", "utf8")).not.toContain("team_mode");
});
