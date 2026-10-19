import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }));

import { cleanPersonName } from "@/lib/clean-person-name";
import { ClientNameControl } from "@/components/coach/client-name-control";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const base = { groupId: "g", athleteId: "a", profileName: "Johann Gorsek", spaceName: "Johann Gorsik", oneOnOne: true };

// Oct 19 audit: three clients show a different name on different screens; Johann is "Gorsek" on his profile and "Gorsik" on his space.
describe("a name as typed", () => {
  it("collapses spaces, trims, and refuses empty, over-long or non-text", () => {
    expect(cleanPersonName("  Johann   Gorsek ")).toBe("Johann Gorsek");
    expect(cleanPersonName("Jo\nhann")).toBe("Jo hann");
    expect(cleanPersonName("   ")).toBeNull();
    expect(cleanPersonName("x".repeat(121))).toBeNull();
    expect(cleanPersonName(null)).toBeNull();
    expect(cleanPersonName(5)).toBeNull();
  });
});

describe("the name control", () => {
  it("a client who has not signed in: Edit name", () => {
    expect(renderToStaticMarkup(createElement(ClientNameControl, { ...base, signedIn: false }))).toContain("Edit name");
  });
  it("a client who has signed in with a space spelled differently: one tap to make the space match their own name", () => {
    const html = renderToStaticMarkup(createElement(ClientNameControl, { ...base, signedIn: true }));
    expect(html).toContain("Their space is named");
    expect(html).toContain("Johann Gorsik");
    expect(html).toContain("Name the space");
    expect(html).not.toContain("Edit name");
  });
  it("nothing to show when the names already match, or the space is not a one-on-one space", () => {
    expect(renderToStaticMarkup(createElement(ClientNameControl, { ...base, spaceName: "Johann Gorsek", signedIn: true }))).toBe("");
    expect(renderToStaticMarkup(createElement(ClientNameControl, { ...base, oneOnOne: false, signedIn: true }))).toBe("");
  });
});

describe("the route", () => {
  const route = read("app/api/clients/rename/route.ts");
  it("only the coach of the space, and the account's name only for a client who has not signed in", () => {
    expect(route).toContain('caller?.role !== "coach"');
    expect(route).toContain("loadUnclaimedClient(supabase, serviceRole, user.id, groupId, athleteId)");
    expect(route.indexOf("loadUnclaimedClient(")).toBeLessThan(route.indexOf('update({ full_name: name })'));
  });
  it("making the space match changes only the space's name, never the account", () => {
    const at = route.indexOf("if (matchSpace) {");
    const block = route.slice(at, route.indexOf("const name = cleanPersonName(body?.fullName);"));
    expect(block).toContain('from("groups").update({ name })');
    expect(block).not.toContain('from("profiles").update');
  });
  it("renames the one-on-one space together with an unclaimed client's name", () => {
    expect(route).toContain('if (isOneOnOne) await serviceRole.from("groups").update({ name }).eq("id", groupId);');
  });
  it("the profile page shows it for a coach viewing a client", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("<ClientNameControl groupId={params.groupId}");
  });
});
