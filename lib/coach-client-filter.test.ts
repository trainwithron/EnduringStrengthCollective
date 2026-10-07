import { describe, it, expect } from "vitest";
import { clientKind, filterClients, filterCounts, type CoachClientRow } from "./coach-client-filter";

const row = (o: Partial<CoachClientRow> & { id: string; fullName: string }): CoachClientRow => ({
  groupId: "g-" + o.id,
  groupName: "G",
  groupKind: "one_on_one",
  tier: null,
  setAside: false,
  toBook: 0,
  owed: 0,
  ...o,
});

const rows = [
  row({ id: "1", fullName: "Alice Athlete" }),
  row({ id: "2", fullName: "Ben Online", tier: "online" }),
  row({ id: "3", fullName: "Cara Team", groupKind: "team", groupName: "Aces" }),
  row({ id: "4", fullName: "Dee Setaside", setAside: true }),
  row({ id: "5", fullName: "Eli Tiered", groupKind: "team", tier: "one_on_one" }),
];

describe("the coach-level Clients list", () => {
  it("shows everyone once, set-aside hidden by default", () => {
    expect(filterClients(rows, "all", "").map((r) => r.id)).toEqual(["1", "2", "3", "5"]);
  });
  it("filters by how they work with the coach, using their tier first and their space otherwise", () => {
    expect(clientKind(rows[0])).toBe("one_on_one");
    expect(clientKind(rows[2])).toBe("group");
    expect(clientKind(rows[4])).toBe("one_on_one");
    expect(filterClients(rows, "one_on_one", "").map((r) => r.id)).toEqual(["1", "5"]);
    expect(filterClients(rows, "online", "").map((r) => r.id)).toEqual(["2"]);
    expect(filterClients(rows, "group", "").map((r) => r.id)).toEqual(["3"]);
  });
  it("shows the set-aside ones only when asked", () => {
    expect(filterClients(rows, "set_aside", "").map((r) => r.id)).toEqual(["4"]);
  });
  it("searches names, ignoring case and spaces at the edges, inside any filter", () => {
    expect(filterClients(rows, "all", "  ben ").map((r) => r.id)).toEqual(["2"]);
    expect(filterClients(rows, "group", "ben")).toEqual([]);
    expect(filterClients(rows, "set_aside", "DEE").map((r) => r.id)).toEqual(["4"]);
    expect(filterClients(rows, "all", "zzz")).toEqual([]);
  });
  it("counts each filter, with set-aside clients counted only under Set aside", () => {
    expect(filterCounts(rows)).toEqual({ all: 4, one_on_one: 2, online: 1, group: 1, set_aside: 1 });
    expect(filterCounts([])).toEqual({ all: 0, one_on_one: 0, online: 0, group: 0, set_aside: 0 });
  });
});
