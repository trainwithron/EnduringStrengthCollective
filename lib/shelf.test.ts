import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ShopCard } from "@/components/shared/shop-card";
import { audienceAllows, buyEnabled, buyerMessageLine, linksForPublic, linksForViewer, productKind, type ShelfViewer } from "@/lib/shelf";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const viewer = (over: Partial<ShelfViewer> = {}): ShelfViewer => ({ isCoach: false, oneOnOne: false, groupIds: [], isMinor: false, ...over });

describe("who in the app sees a card or product", () => {
  it("everyone, not the one-on-one clients, only the one-on-one clients", () => {
    expect(audienceAllows("everyone", null, viewer())).toBe(true);
    expect(audienceAllows("not_one_on_one", null, viewer({ oneOnOne: true }))).toBe(false);
    expect(audienceAllows("not_one_on_one", null, viewer({ oneOnOne: false }))).toBe(true);
    expect(audienceAllows("only_one_on_one", null, viewer({ oneOnOne: true }))).toBe(true);
    expect(audienceAllows("only_one_on_one", null, viewer({ oneOnOne: false }))).toBe(false);
  });
  it("one group: members of that group only, and never when no group is set", () => {
    expect(audienceAllows("one_group", "g1", viewer({ groupIds: ["g1", "g2"] }))).toBe(true);
    expect(audienceAllows("one_group", "g1", viewer({ groupIds: ["g2"] }))).toBe(false);
    expect(audienceAllows("one_group", null, viewer({ groupIds: ["g1"] }))).toBe(false);
  });
  it("the coach previewing their own shelf sees everything", () => {
    expect(audienceAllows("only_one_on_one", null, viewer({ isCoach: true }))).toBe(true);
    expect(audienceAllows("one_group", "g1", viewer({ isCoach: true }))).toBe(true);
  });
});

describe("the link cards a client sees", () => {
  const links = [
    { id: "a", category: "merch", audience: "everyone" },
    { id: "b", category: "merch", audience: "only_one_on_one" },
    { id: "c", category: "supplements", audience: "everyone" },
    { id: "d", category: "merch", audience: "one_group", audienceGroupId: "g1" },
    { id: "e", category: "merch", audience: null },
  ];
  it("filters by audience; a card with no audience set is for everyone", () => {
    expect(linksForViewer(links, viewer({ groupIds: ["g1"] })).map((l) => l.id)).toEqual(["a", "c", "d", "e"]);
    expect(linksForViewer(links, viewer({ oneOnOne: true })).map((l) => l.id)).toEqual(["a", "b", "c", "e"]);
  });
  it("a client known to be under 18 is not shown supplements", () => {
    expect(linksForViewer(links, viewer({ isMinor: true })).map((l) => l.id)).toEqual(["a", "e"]);
    expect(linksForViewer(links, viewer({ isMinor: false })).map((l) => l.id)).toContain("c");
  });
});

describe("the public page", () => {
  it("shows only cards marked public AND open to everyone", () => {
    const links = [
      { id: "a", category: "merch", showOnPublic: true, audience: "everyone" },
      { id: "b", category: "merch", showOnPublic: true, audience: "only_one_on_one" },
      { id: "c", category: "merch", showOnPublic: false, audience: "everyone" },
      { id: "d", category: "merch", showOnPublic: true },
    ];
    expect(linksForPublic(links).map((l) => l.id)).toEqual(["a", "d"]);
  });
  it("the public page asks the database for exactly that", () => {
    const page = read("app/c/[slug]/page.tsx");
    expect(page).toContain('.eq("show_on_public", true).eq("audience", "everyone")');
    expect(page).not.toContain('.eq("featured", true)');
  });
});

describe("product kinds and Buy", () => {
  it("a package is a program, group access or sessions by what it has attached", () => {
    expect(productKind({ defaultProgramId: "p" })).toBe("program");
    expect(productKind({ groupAccessGroupId: "g" })).toBe("group_access");
    expect(productKind({ defaultProgramId: "p", groupAccessGroupId: "g" })).toBe("program");
    expect(productKind({})).toBe("sessions");
  });
  it("no Buy anywhere until the checkout that pays the coach exists, even with Connect finished", () => {
    expect(buyEnabled("enabled")).toBe(false);
    expect(buyEnabled("pending")).toBe(false);
    expect(buyEnabled(null)).toBe(false);
  });
  it("a Buy card is not drawn when buying is not possible; a Shop card is drawn as before", () => {
    const base = { title: "Program", href: "https://example.com", price: "$99" };
    expect(renderToStaticMarkup(createElement(ShopCard, { ...base, kind: "buy" }))).toBe("");
    expect(renderToStaticMarkup(createElement(ShopCard, { ...base, kind: "buy", canBuy: true }))).toContain(">Buy<");
    expect(renderToStaticMarkup(createElement(ShopCard, { title: "Merch", href: "https://example.com/m" }))).toContain(">Shop<");
  });
  it("the line beside Buy for a program buyer", () => {
    expect(buyerMessageLine("Ron")).toBe("You can message Ron; replies aren't guaranteed.");
    expect(buyerMessageLine(" ")).toBe("You can message your coach; replies aren't guaranteed.");
  });
});

describe("saving a placement", () => {
  const route = read("app/api/coach/shelf-placement/route.ts");
  it("is the coach's own row only, and a group audience must be a group the coach coaches", () => {
    expect(route).toContain('.eq("coach_id", user.id)');
    expect(route).toContain("groupBelongsToCoach(supabase, user.id, groupId)");
    expect(route).toContain("isAudience(body.audience)");
    expect(route).toContain('body.audience === "one_group"');
  });
  it("the controls are on every package and every Pro Shop card, with the agreed wording", () => {
    const controls = read("components/coach/desktop/shelf-placement-controls.tsx");
    for (const s of ["Where it shows", "Public page", "Client Home", "Pro Shop", "Show on my public page", "Who sees it in the app", "Buyer also joins my client space (can message me)", "Buy buttons appear on their own once your Stripe account is connected."]) {
      expect(controls, s).toContain(s);
    }
    expect(read("components/coach/desktop/package-manager.tsx")).toContain("<ShelfPlacementControls");
    expect(read("components/coach/desktop/pro-shop-manager.tsx")).toContain("<ShelfPlacementControls");
  });
  it("the client's Pro Shop and Home apply the audience; the coach previews everything", () => {
    expect(read("app/(coach)/groups/[groupId]/resources/page.tsx")).toContain("linksForViewer(links, shelfViewer)");
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain("linksForViewer(");
  });
});
