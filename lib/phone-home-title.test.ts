import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeTitle } from "@/lib/phone-home-title";

describe("the phone Home title is the organization", () => {
  it("shows the organization's name with the group's own name under it", () => {
    expect(homeTitle({ kind: "team", orgName: "Enduring Strength Co." }, "The Enduring Strength Collective")).toEqual({ main: "Enduring Strength Co.", sub: "The Enduring Strength Collective" });
  });
  it("says it once when the two names are the same", () => {
    expect(homeTitle({ kind: "team", orgName: "Coast2Coast Fitness" }, "coast2coast fitness")).toEqual({ main: "Coast2Coast Fitness", sub: null });
  });
  it("a client's own space keeps the client's name; an unknown organization keeps the group's name", () => {
    expect(homeTitle({ kind: "one_on_one", orgName: "Enduring Strength Co." }, "Sawyer S.")).toEqual({ main: "Sawyer S.", sub: null });
    expect(homeTitle(undefined, "Some Group")).toEqual({ main: "Some Group", sub: null });
    expect(homeTitle({ kind: "team", orgName: "  " }, "Some Group")).toEqual({ main: "Some Group", sub: null });
  });
  it("the phone Home uses it for the header", () => {
    const home = readFileSync("components/coach/mobile/coach-mobile-home.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(home).toContain("const title = homeTitle(pageGroup, groupName);");
    expect(home).toContain("{title.main}</h1>");
  });
});
