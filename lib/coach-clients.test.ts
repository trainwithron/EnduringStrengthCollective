import { describe, expect, it } from "vitest";
import { dedupeClients, type CoachClient } from "@/lib/coach-clients";

const c = (id: string, fullName: string, groupId: string, groupKind: CoachClient["groupKind"]): CoachClient => ({ id, fullName, avatarUrl: null, groupId, groupKind });

describe("dedupeClients", () => {
  it("lists a client once, under their one-on-one space, sorted by name", () => {
    const out = dedupeClients([c("b", "Bea", "team1", "team"), c("a", "Al", "team1", "team"), c("b", "Bea", "solo-b", "one_on_one")]);
    expect(out.map((x) => x.fullName)).toEqual(["Al", "Bea"]);
    expect(out.find((x) => x.id === "b")?.groupId).toBe("solo-b");
  });
  it("keeps a team-only client in their team group", () => {
    expect(dedupeClients([c("a", "Al", "team1", "team")])[0].groupId).toBe("team1");
  });
  it("prefers a team group over a social one", () => {
    expect(dedupeClients([c("a", "Al", "soc", "social"), c("a", "Al", "team1", "team")])[0].groupId).toBe("team1");
  });
});
