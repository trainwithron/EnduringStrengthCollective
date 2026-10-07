import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { SwappableTerm } from "./swappable-term";
import { TerminologyChooser } from "./desktop/terminology-chooser";
import { TerminologyFirstRunCard } from "./desktop/terminology-first-run-card";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("a swapped word looks finished", () => {
  it("is plain text by default: no button, no underline, no hover", () => {
    const html = renderToStaticMarkup(createElement(SwappableTerm, { termKey: "client", form: "plural" }));
    expect(html).toBe("<span>clients</span>");
    expect(html).not.toMatch(/underline|decoration|<button/);
  });
  it("starts a label in proper case, and stays lowercase mid-sentence", () => {
    expect(renderToStaticMarkup(createElement(SwappableTerm, { termKey: "client", form: "plural", cap: true }))).toBe("<span>Clients</span>");
    // the older className="capitalize" means the same thing, without the CSS title-casing
    expect(renderToStaticMarkup(createElement(SwappableTerm, { termKey: "client", form: "plural", className: "capitalize" }))).toBe("<span>Clients</span>");
    expect(renderToStaticMarkup(createElement(SwappableTerm, { termKey: "client", form: "singular" }))).toBe("<span>client</span>");
  });
  it("keeps other styling classes while dropping the old capitalize class", () => {
    expect(renderToStaticMarkup(createElement(SwappableTerm, { termKey: "program", form: "plural", className: "font-bold capitalize" }))).toBe('<span class="font-bold">Programs</span>');
  });
  it("is clickable only where it is asked to be (the Settings panel)", () => {
    const html = renderToStaticMarkup(createElement(SwappableTerm, { termKey: "client", form: "plural", editable: true, cap: true }));
    expect(html).toContain("<button");
    expect(html).toContain("Clients");
    expect(read("./desktop/terminology-settings-panel.tsx")).toContain("editable cap");
    for (const f of ["../../app/(coach)/groups/[groupId]/clients/page.tsx", "../../app/(coach)/groups/[groupId]/business/page.tsx", "./coach-desktop-shell.tsx", "./desktop/dashboard-stat-tiles.tsx", "../../app/(coach)/groups/[groupId]/programs/page.tsx"]) {
      expect(read(f)).not.toMatch(/<SwappableTerm[^>]*\beditable\b/);
    }
  });
});

describe("the word is chosen once and changed in Settings", () => {
  it("the chooser asks 'What do you call your people?' with the four words and your own", () => {
    const html = renderToStaticMarkup(createElement(TerminologyChooser, { groupId: "g" }));
    expect(html).toContain("What do you call your people?");
    for (const w of ["Clients", "Athletes", "Players", "Members", "Something else"]) expect(html).toContain(w);
  });
  it("the first-run card on Home is that question (not a nudge to click words), and it is asked once", () => {
    const src = read("./desktop/terminology-first-run-card.tsx");
    expect(src).toContain("What do you call your people?");
    expect(src).toContain("TerminologyChooser");
    expect(src).not.toContain("click any word");
    // before it has read its saved state it shows nothing, so it never flashes for someone who already answered
    expect(renderToStaticMarkup(createElement(TerminologyFirstRunCard, { groupId: "g" }))).toBe("");
  });
  it("Settings has the question for coaches, on desktop and the phone's Settings page, and the full list stays in Branding", () => {
    const settings = read("../../app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(settings).toContain('label="What do you call your people?"');
    expect(settings).toContain("<TerminologyChooser");
    expect(read("./desktop/terminology-settings-panel.tsx")).toContain("What do you call your people?");
  });
  it("the phone's coach screens carry the vocabulary, so the Spotlight tile and More list use the chosen word", () => {
    expect(read("./mobile/coach-mobile-shell.tsx")).toContain("<TerminologyProvider groupId={groupId}>");
    expect(read("./mobile/coach-spot-hub.tsx")).toContain('t("client", "plural", { cap: true })');
    expect(read("./mobile/coach-nav-links-list.tsx")).toContain('${t("client", "plural", { cap: true })} and ${t("session", "plural")}');
  });
  it("the main buttons, headers and empty states use the chosen word", () => {
    expect(read("./desktop/add-client-button.tsx")).toContain('Add {t("client")}');
    expect(read("./desktop/pulse-tabs.tsx")).toContain('<SwappableTerm termKey="client" cap /> Pulse');
    expect(read("../../app/(coach)/groups/[groupId]/clients/page.tsx")).toContain('Only coaches can manage <SwappableTerm termKey="client" form="plural" />');
  });
});
