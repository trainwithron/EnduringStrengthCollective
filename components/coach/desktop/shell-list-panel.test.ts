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
  it("the Clients tile shows the full Clients page in the panel, which has the same Add client (split screen, Ron, Oct 19)", () => {
    expect(panel).not.toContain("<AddClientButton");
    expect(panel).not.toContain("<RosterMiniList");
    expect(src("../../../app/(coach)/clients/page.tsx")).toContain("<AddClientButton");
  });
  it("the button still tells whoever opened it that someone was added", () => {
    expect(button).toContain("onAdded?.();");
  });
  it("the shell hands the panel the group's name", () => {
    expect(shell).toContain("groupName={groupName}");
  });
});

describe("the coach's groups are read again after someone is added", () => {
  it("a cached lookup is reused, and forgetting it makes the next load ask again (so a new one-on-one client's own group is found)", async () => {
    vi.resetModules();
    let calls = 0;
    vi.doMock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "coach" } } }) } }) }));
    vi.doMock("@/lib/coach-groups", () => ({
      getCoachedGroups: async () => {
        calls++;
        return [{ id: "g1", name: "G", group_kind: "team", organization_id: "o1" }];
      },
      groupsInOrgOf: (all: unknown[]) => all,
    }));
    const mod = await import("@/lib/use-org-group-ids");
    await mod.loadOrgGroups("g1");
    await mod.loadOrgGroups("g1");
    expect(calls).toBe(1);
    mod.forgetOrgGroups();
    await mod.loadOrgGroups("g1");
    expect(calls).toBe(2);
    vi.doUnmock("@/lib/supabase/client");
    vi.doUnmock("@/lib/coach-groups");
  });
  it("the panel no longer reads a list of its own (the full Clients page in it reads its own)", () => {
    expect(panel).not.toContain("forgetOrgGroups();");
  });
});
