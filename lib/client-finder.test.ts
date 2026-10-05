import { describe, expect, it } from "vitest";
import { dedupeClients, rankClientMatches, type FinderClient } from "./client-finder";

const c = (id: string, fullName: string, groupId = "g1", groupName: string | null = null): FinderClient => ({ id, fullName, groupId, groupName });
const people = [c("1", "Anna Lee"), c("2", "Joanna Park"), c("3", "Lee Anderson"), c("4", "José Álvarez"), c("5", "Bo Chen"), c("6", "Mary-Ann Ford")];

describe("rankClientMatches", () => {
  it("puts names that start with the query first, then words, then anything inside", () => {
    expect(rankClientMatches("ann", people).map((p) => p.fullName)).toEqual(["Anna Lee", "Mary-Ann Ford", "Joanna Park"]);
  });
  it("matches a last name", () => {
    expect(rankClientMatches("lee", people).map((p) => p.fullName)).toEqual(["Lee Anderson", "Anna Lee"]);
  });
  it("ignores case and accents", () => {
    expect(rankClientMatches("JOSE", people).map((p) => p.fullName)).toEqual(["José Álvarez"]);
    expect(rankClientMatches("alvarez", people)).toHaveLength(1);
  });
  it("shows everyone alphabetically for an empty query, capped", () => {
    const many = Array.from({ length: 20 }, (_, i) => c(String(i), `Client ${String(i).padStart(2, "0")}`));
    const out = rankClientMatches("  ", many, 8);
    expect(out).toHaveLength(8);
    expect(out[0].fullName).toBe("Client 00");
  });
  it("returns nothing when nothing matches", () => {
    expect(rankClientMatches("zzz", people)).toEqual([]);
  });
});

describe("dedupeClients", () => {
  it("lists a person once, preferring the group the coach is in", () => {
    const rows = [c("1", "Anna", "gA"), c("1", "Anna", "gB"), c("2", "Bo", "gA")];
    const out = dedupeClients(rows, "gB");
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.id === "1")?.groupId).toBe("gB");
    expect(dedupeClients(rows, null).find((p) => p.id === "1")?.groupId).toBe("gA");
  });
});
