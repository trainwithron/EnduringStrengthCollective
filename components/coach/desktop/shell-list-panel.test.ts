import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { AddClientButton } from "@/components/coach/desktop/add-client-button";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const panel = src("./shell-list-panel.tsx");
const shell = src("../coach-desktop-shell.tsx");
const button = src("./add-client-button.tsx");

describe("Add client in the left panel", () => {
  it("is the same Add client as on the Clients page, a 44 px sentence-case button", () => {
    const html = renderToStaticMarkup(createElement(AddClientButton, { groupId: "g1", groupName: "Group", createdBy: "c1" }));
    expect(html).toContain("Add client");
    expect(html).toContain("h-11");
    expect(html).not.toMatch(/(^| )bg-rust( |")/); // outlined, not the filled main-action style: the panel's main job is finding a client
  });
  it("sits at the top of the client list, above the first client, in the open panel only", () => {
    const roster = panel.slice(panel.indexOf('{view === "roster" && ('));
    expect(roster.indexOf("<AddClientButton")).toBeGreaterThan(-1);
    expect(roster.indexOf("<AddClientButton")).toBeLessThan(roster.indexOf("<RosterMiniList"));
    // the collapsed panel returns early with only the expand tab, so nothing of this shows there
    const collapsedBranch = panel.slice(panel.indexOf("if (collapsed) {"), panel.indexOf("return (\n    <div\n      className=\"hidden lg:flex shrink-0 border-r"));
    expect(collapsedBranch).not.toContain("AddClientButton");
  });
  it("only in the Clients view, not in Business, Calendar or Program", () => {
    expect(panel.match(/<AddClientButton/g)).toHaveLength(1);
    expect(panel.indexOf("<AddClientButton")).toBeGreaterThan(panel.indexOf('{view === "roster" && ('));
    expect(panel.indexOf("<AddClientButton")).toBeLessThan(panel.indexOf('{view === "business"'));
  });
  it("the list shows the new client at once: it is read again when someone is added", () => {
    expect(button).toContain("onAdded?.();");
    expect(panel).toContain("onAdded={() => setRosterVersion((v) => v + 1)}");
    expect(panel).toContain("<RosterMiniList key={rosterVersion}");
  });
  it("the shell hands the panel the group's name", () => {
    expect(shell).toContain("groupName={groupName}");
  });
});
