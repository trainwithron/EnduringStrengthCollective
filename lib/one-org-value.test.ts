import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPrefetchRequest, switchConfirmPath, workspaceDecision, ACTIVE_ORG_COOKIE } from "./active-org";
import { ACTIVE_ORG_COOKIE_NAME, WORKSPACE_HEADER, WORKSPACE_ORG_HEADER, workspaceHeadersFor } from "./workspace-header";

// FIX 4: one organization value everywhere. Ron, Oct 19: "It should be just a quick, are you sure you want to switch to coast to coast? Yes, no, and then yes, go. Obviously, no, stop."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const G = "6f1c2b3a-0000-4000-8000-000000000001";

describe("what opening a group page does", () => {
  const base = { isPageLoad: true, inFrame: false, pageOrg: A, activeOrg: A, isCoachThere: true };
  it("a page of the chosen organization is remembered, as before; so is any page when none is chosen yet", () => {
    expect(workspaceDecision(base)).toBe("remember");
    expect(workspaceDecision({ ...base, activeOrg: null })).toBe("remember");
  });
  it("a page of ANOTHER organization asks a coach first", () => {
    expect(workspaceDecision({ ...base, pageOrg: B })).toBe("confirm");
  });
  it("...a client there is remembered as before (the question is for coaches); a frame never asks and changes nothing", () => {
    expect(workspaceDecision({ ...base, pageOrg: B, isCoachThere: false })).toBe("remember");
    expect(workspaceDecision({ ...base, pageOrg: B, inFrame: true })).toBe("nothing");
  });
  it("the personal space (no organization) and anything that is not a page load change nothing", () => {
    expect(workspaceDecision({ ...base, pageOrg: null })).toBe("nothing");
    expect(workspaceDecision({ ...base, isPageLoad: false, pageOrg: B })).toBe("nothing");
  });
  it("prefetches are recognised however the browser marks them", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    expect(isPrefetchRequest(h({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isPrefetchRequest(h({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetchRequest(h({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetchRequest(h({}))).toBe(false);
  });
  it("the confirm is the chooser page, with the page to open after Yes", () => {
    expect(switchConfirmPath(B, `/groups/${G}/clients?x=1`)).toBe(`/choose-organization?switch=${B}&next=${encodeURIComponent(`/groups/${G}/clients?x=1`)}`);
  });
});

describe("the middleware", () => {
  const mw = read("lib/supabase/middleware.ts");
  const block = mw.slice(mw.indexOf("FIX 4 (one organization value everywhere)"), mw.indexOf("  return response;\n}"));
  it("writes nothing on a prefetch or anything but a page load", () => {
    expect(block).toContain('const pageGroup = user && request.method === "GET" && !isPrefetchRequest(request.headers) ? groupIdFromPath(pathname) : null;');
  });
  it("asks before another organization's page, carrying the cookies, and remembers only on 'remember'", () => {
    expect(block).toContain('if (decision === "confirm" && memberOrg) {');
    expect(block).toContain("switchConfirmPath(memberOrg, pathname + request.nextUrl.search)");
    expect(block).toContain("confirmResponse.cookies.set(cookie);");
    expect(block).toContain('if (decision === "remember" && memberOrg) {');
    expect(block).toContain('inFrame: request.headers.get("sec-fetch-dest") === "iframe"');
  });
});

describe("the chooser as the one-question confirm", () => {
  const page = read("app/choose-organization/page.tsx");
  it("asks 'Switch to <name>?' with Yes (switch, then open the page) and No (stay: the current organization's Home)", () => {
    expect(page).toContain("Switch to {switchTo.name}?");
    expect(page).toContain("href={`/choose-organization/select?org=${switchTo.id}&next=${encodeURIComponent(next)}`}");
    expect(page).toContain('<a href="/dashboard"');
    expect(page).toContain(">\n              No\n");
  });
  it("only for an organization the person coaches in, and no new page", () => {
    expect(page).toContain("const switchTo = search.switch ? orgs.find((o) => o.id === search.switch) : undefined;");
  });
  it("uses plain links, so showing them never switches anything (no prefetch of the select route)", () => {
    expect(page).not.toContain("next/link");
    expect(page).not.toContain("<Link");
  });
  it("the select route answers a prefetch with nothing (204, no cookies)", () => {
    const route = read("app/choose-organization/select/route.ts");
    expect(route).toContain("if (isPrefetchRequest(request.headers)) return new NextResponse(null, { status: 204 });");
    expect(route.indexOf("isPrefetchRequest(request.headers)")).toBeLessThan(route.indexOf("response.cookies.set(ACTIVE_ORG_COOKIE"));
  });
});

describe("the database is told the chosen organization", () => {
  it("the cookie names agree", () => {
    expect(ACTIVE_ORG_COOKIE_NAME).toBe(ACTIVE_ORG_COOKIE);
  });
  it("in the browser: only the group on a group page; the group and the organization elsewhere; nothing on a page that sends no workspace", () => {
    const cookie = `last_workspace_group=${G}; active_org=${encodeURIComponent(A)}`;
    expect(workspaceHeadersFor(`/groups/${G}/clients`, cookie)).toEqual({ [WORKSPACE_HEADER]: G });
    expect(workspaceHeadersFor("/clients", cookie)).toEqual({ [WORKSPACE_HEADER]: G, [WORKSPACE_ORG_HEADER]: A });
    expect(workspaceHeadersFor("/notifications", cookie)).toEqual({});
    expect(workspaceHeadersFor("/clients", "active_org=not-an-id")).toEqual({});
  });
  it("on the server: both headers", () => {
    const server = read("lib/supabase/server.ts");
    expect(server).toContain("if (org) headers[WORKSPACE_ORG_HEADER] = org;");
    expect(server).toContain("decodeWorkspaceCookie(cookieStore.get(ACTIVE_ORG_COOKIE_NAME)?.value)");
  });
  it("migration 0425 reads x-workspace-org, only for an organization the person belongs to, and keeps the group fallback and the switch", () => {
    const sql = read("supabase/migrations/0425_org_wall_follows_active_org.sql");
    expect(sql).toContain("->> 'x-workspace-org'");
    expect(sql).toContain("exists (select 1 from public.group_memberships gm join public.groups g on g.id = gm.group_id where gm.profile_id = auth.uid() and g.organization_id = o.id)");
    expect(sql).toContain("exists (select 1 from public.organization_memberships om where om.organization_id = o.id and om.profile_id = auth.uid())");
    expect(sql).toContain("->> 'x-workspace-group'");
    expect(sql).toContain("public.org_wall_header_enabled()");
    expect(sql).toContain("security definer");
    expect(sql).not.toContain("function public.group_in_active_org");
  });
});

describe("the look and the words follow the chosen organization", () => {
  it("the desktop shell no longer writes the workspace cookie (only the middleware does)", () => {
    const shell = read("components/coach/coach-desktop-shell.tsx");
    expect(shell).not.toContain("LAST_WORKSPACE_GROUP_COOKIE");
    expect(shell).not.toMatch(/document.cookie = `last_workspace_group/);
  });
  it("colors, team words, the layout stamp and the feed", () => {
    expect(read("lib/org-theme-server.ts")).toContain('supabase.from("groups").select("id").eq("organization_id", chosen).limit(1)');
    expect(read("lib/team-words-server.ts")).toContain("if (chosenOrg && organizationId && organizationId !== chosenOrg) return NO_TEAM_WORDS_HINT;");
    expect(read("app/layout.tsx")).toContain("data-active-org={activeOrg}");
    expect(read("app/(coach)/groups/[groupId]/feed/page.tsx")).toContain("rememberedGroupForActiveOrg(shared, decodeCookieValue(jar.get(ACTIVE_ORG_COOKIE)?.value), lastGroup)");
  });
});
