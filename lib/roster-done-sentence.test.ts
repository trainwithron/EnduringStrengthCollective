import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("components/coach/desktop/roster-import-panel.tsx", "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: importing a roster and then sharing the group's invite link makes duplicate people.
describe("the roster import's done screen", () => {
  it("says to send each person their own sign-in link, and what happens if they use the group's invite link instead", () => {
    expect(panel).toContain("Send each one their own sign-in link from their profile. If they use the group&apos;s invite link instead, they will be added a second time.");
  });
  it("only when someone was actually added and the import was not undone", () => {
    expect(panel).toContain("{!undone && addedIds.length > 0 && <p");
  });
});
