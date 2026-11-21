import { describe, it, expect } from "vitest";
import { homeTabs, stripEntries, type HomeFacts } from "./desktop-coach-homes";

const ordinary: HomeFacts = { groupId: "g1", coachLevel: false, groupKind: "team", teamMode: false, teamSport: false, moneyHidden: false, navFacts: null, isPlatformAdmin: false, onFrontDesk: false };
const shown = (f: HomeFacts) => stripEntries(homeTabs(f).settings).map((e) => [e.label, e.tabs.map((t) => t.label)]);

// Ron, Nov 2: Settings' pages grouped into a few tabs. Clutter audit (Nov 21): Display mode moved next to Kiosk on Calendar (DK17), Text messages and Zapier are Integrations
// (DK17), and every platform chore is one Admin group (DK3).
describe("Settings' tabs, each group's pages picked under the strip", () => {
  it("a coach sees Account, Integrations, Organization, Website & shop, Help", () => {
    expect(shown(ordinary)).toEqual([
      ["Account", ["Account"]],
      ["Integrations", ["Text messages", "Zapier"]],
      ["Organization", ["Organization"]],
      ["Website & shop", ["My website", "Pro shop and referrals"]],
      ["Help", ["Support", "Quick tips"]],
    ]);
  });

  it("the platform admin also sees Admin, with every platform chore in it", () => {
    expect(shown({ ...ordinary, isPlatformAdmin: true }).at(-1)).toEqual(["Admin", ["Support inbox", "Organizations", "Marketplace ranking", "Recipe ingredients", "Machine requests", "Billing preview"]]);
  });

  it("a group tab opens its first page; where money is hidden, Website & shop goes and Zapier leaves Integrations", () => {
    const entries = stripEntries(homeTabs(ordinary).settings);
    expect(entries.find((e) => e.label === "Website & shop")?.href).toBe("/groups/g1/business/website");
    const noMoney = shown({ ...ordinary, moneyHidden: true });
    expect(noMoney.map((e) => e[0])).toEqual(["Account", "Integrations", "Organization", "Help"]);
    expect(noMoney[1][1]).toEqual(["Text messages"]);
  });

  it("Calendar folds Booking page and Session types under Availability, Home folds the business pages under Business (DK10); the other homes have no groups", () => {
    const t = homeTabs(ordinary);
    expect(stripEntries(t.calendar).map((e) => [e.label, e.tabs.map((x) => x.label)])).toEqual([
      ["Schedule", ["Schedule"]],
      ["Availability", ["Availability", "Booking page", "Session types"]],
      ["Group calendar", ["Group calendar"]],
      ["Kiosk check-in", ["Kiosk check-in"]],
      ["Display mode", ["Display mode"]],
    ]);
    expect(stripEntries(t.home).map((e) => [e.label, e.tabs.map((x) => x.label)])).toEqual([
      ["Today", ["Today"]],
      ["Business", ["Overview", "Packages", "Session ledger", "Waiver", "Leads"]],
    ]);
    for (const home of ["clients", "programs", "messages"] as const) expect(stripEntries(t[home]).length).toBe(t[home].length);
  });
});
