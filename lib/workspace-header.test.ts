import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asWorkspaceGroupId, decodeWorkspaceCookie, groupIdFromPath } from "@/lib/workspace-header";

const G = "060017b5-e613-4204-a101-c6a14c3a9630";
const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the workspace a request names", () => {
  it("only a group id is ever sent", () => {
    expect(asWorkspaceGroupId(G)).toBe(G);
    expect(asWorkspaceGroupId(G.toUpperCase())).toBe(G);
    expect(asWorkspaceGroupId("not-a-group")).toBeNull();
    expect(asWorkspaceGroupId("")).toBeNull();
    expect(asWorkspaceGroupId(null)).toBeNull();
  });
  it("reads the remembered workspace cookie, encoded or not", () => {
    expect(decodeWorkspaceCookie(encodeURIComponent(G))).toBe(G);
    expect(decodeWorkspaceCookie(G)).toBe(G);
    expect(decodeWorkspaceCookie("%E0%A4%A")).toBeNull();
    expect(decodeWorkspaceCookie(undefined)).toBeNull();
  });
  it("a group page names its own group", () => {
    expect(groupIdFromPath(`/groups/${G}/business`)).toBe(G);
    expect(groupIdFromPath(`/groups/${G}`)).toBe(G);
    expect(groupIdFromPath("/dashboard")).toBeNull();
    expect(groupIdFromPath("/groups/new")).toBeNull();
  });
});

describe("the header is wired in everywhere data is read", () => {
  it("the browser client and the server client both send it, and the cross-organization copy does not", () => {
    expect(read("lib/supabase/client.ts")).toContain("global: { fetch: workspaceFetch }");
    expect(read("lib/supabase/client.ts")).toContain("crossOrg");
    expect(read("lib/supabase/server.ts")).toContain("global: workspaceHeaders(");
    expect(read("components/coach/desktop/program-card-menu.tsx")).toContain("createBrowserClient({ crossOrg: true })");
  });
  it("opening a group page makes it the workspace, only for a group the person belongs to", () => {
    const mw = read("lib/supabase/middleware.ts");
    expect(mw).toContain('.from("group_memberships").select("group_id").eq("group_id", pageGroup).eq("profile_id", user.id)');
    expect(mw).toContain("request.cookies.set(LAST_WORKSPACE_GROUP_COOKIE");
  });
  it("the rule in the database ships switched off first and has a separate switch-on step", () => {
    expect(read("supabase/migrations/0348_org_wall_request_header.sql")).toContain("as $$ select false $$;");
    expect(read("supabase/migrations/0349_org_wall_header_on.sql")).toContain("as $$ select true $$;");
  });
});
