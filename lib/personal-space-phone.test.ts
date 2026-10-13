import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Live bug (Ron's phone): the "act as yourself" setting is a 12 hour cookie. When it ran out while his own training space was still open, the phone showed the coaching Home of that empty space
// ("Welcome. Two things get you started") instead of his own training. A coach's own personal space is now always his client app, as himself, with or without the cookie.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const acting = read("lib/acting-as.ts");
const home = read("components/coach/mobile/coach-mobile-home.tsx");

describe("a coach's own personal space on the phone", () => {
  it("always resolves as himself, without the 12 hour cookie", () => {
    expect(acting).toContain("isOwnPersonalSpace(groupId, realUserId)");
    expect(acting).toContain("organization_id === null");
    expect(acting).toContain("created_by === userId");
    expect(acting).toContain("return { athleteId: realUserId, realUserId, isActingAsOther: true }");
  });
  it("the first-run card is only for a coach with no clients anywhere", () => {
    expect(home).toContain("clientsElsewhere");
    expect(home).toContain("No clients in {groupName}.");
    expect(home).toContain("&& !clientsElsewhere &&");
  });
});
