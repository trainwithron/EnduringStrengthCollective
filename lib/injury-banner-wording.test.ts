import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Oct 19 audit: the injury banner told the client their calorie target "has been raised" when nothing had changed it. It now says only what is true.
it("the injury banner makes no claim about the client's target", () => {
  const page = readFileSync("app/(coach)/groups/[groupId]/nutrition/page.tsx", "utf8").replace(/\r\n/g, "\n");
  expect(page).not.toContain("has been raised");
  expect(page).toContain("Eating enough matters while you recover: undereating during an injury measurably slows healing.");
  expect(page).toContain("Your coach has marked you as currently injured");
});
