import { describe, it, expect } from "vitest";
import { homeTabs, stripEntries, type HomeFacts } from "./desktop-coach-homes";

const ordinary: HomeFacts = { groupId: "g1", coachLevel: false, groupKind: "team", teamMode: false, teamSport: false, moneyHidden: false, navFacts: null, isPlatformAdmin: false, onFrontDesk: false };
const shown = (f: HomeFacts) => stripEntries(homeTabs(f).settings).map((e) => [e.label, e.tabs.map((t) => t.label)]);

describe("Settings has five tabs, each group's pages picked under the strip (Ron, Nov 2)", () => {
  it("a coach sees Account, Organization, Website & shop, Help", () => {
    expect(shown(ordinary)).toEqual([
      ["Account", ["Account", "Display mode", "Text messages", "Zapier"]],
      ["Organization", ["Organization"]],
      ["Website & shop", ["My website", "Pro shop and referrals"]],
      ["Help", ["Support", "Quick tips"]],
    ]);
  });

  it("the platform admin also sees Admin", () => {
    expect(shown({ ...ordinary, isPlatformAdmin: true }).at(-1)).toEqual(["Admin", ["Organizations", "Marketplace ranking"]]);
  });

  it("a group tab opens its first page; where money is hidden, Website & shop goes and Zapier leaves Account", () => {
    const entries = stripEntries(homeTabs(ordinary).settings);
    expect(entries.find((e) => e.label === "Website & shop")?.href).toBe("/groups/g1/business/website");
    const noMoney = shown({ ...ordinary, moneyHidden: true });
    expect(noMoney.map((e) => e[0])).toEqual(["Account", "Organization", "Help"]);
    expect(noMoney[0][1]).not.toContain("Zapier");
  });

  it("other homes are unchanged (no groups there)", () => {
    const t = homeTabs(ordinary);
    for (const home of ["home", "clients", "calendar", "programs", "messages"] as const) expect(stripEntries(t[home]).length).toBe(t[home].length);
  });
});
