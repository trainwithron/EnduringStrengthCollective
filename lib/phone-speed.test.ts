import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Phone speed (Ron, Oct 20: "loading times have been pretty slow. Especially on mobile."). Group 1: less JavaScript on the common pages, the service worker asks for a page while it
// wakes up, and the coach layout never waits on the email-change banner. No behaviour changes.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("group 1", () => {
  it("B1: Node's crypto is not in the file client pages import; the token lives in a server file", () => {
    expect(read("lib/client-claim.ts")).not.toMatch(/from "crypto"/);
    const token = read("lib/client-claim-token.ts");
    expect(token).toContain('from "crypto"');
    expect(token).toContain("export function generateClaimToken");
    expect(token).toContain("export function hashClaimToken");
    for (const f of ["lib/client-claim-server.ts", "lib/email-change.ts", "lib/public-booking-engine.ts", "app/api/public-booking/manage/[token]/route.ts", "app/claim/[token]/route.ts"]) {
      expect(read(f), f).toContain('from "@/lib/client-claim-token"');
    }
  });
  it("B2: the spreadsheet reader is loaded only when a file is read", () => {
    for (const f of ["components/coach/desktop/roster-import-panel.tsx", "components/coach/desktop/import-wizard.tsx", "components/coach/exercise-history-uploader.tsx"]) {
      expect(read(f), f).not.toMatch(/^import[^\n]*from "xlsx/m);
      expect(read(f), f).toContain('import("xlsx")');
    }
    expect(read("components/coach/desktop/import-wizard.tsx")).toContain('import("xlsx/dist/cpexcel.full.mjs")');
  });
  it("B3: Spotlight's six panels load when opened; what needs you stays", () => {
    const hub = read("components/coach/mobile/coach-spot-hub.tsx");
    for (const name of ["BusinessMiniDashboard", "AskSpotChatPanel", "QuickPaymentPanel", "SpotBuilderPanel", "SpotClientsGroupsPanel", "SpotMessagesPanel"]) {
      expect(hub, name).toMatch(new RegExp(`const ${name} = dynamic\\(`));
      expect(hub, name).not.toMatch(new RegExp(`^import \\{ ${name} \\}`, "m"));
    }
    expect(hub).toContain('import { SpotNeedsTop } from "./spot-needs-top";');
  });
  it("B10: the service worker uses navigation preload and a fresh static cache", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain("self.registration.navigationPreload.enable()");
    expect(sw).toContain("await event.preloadResponse");
    expect(sw).toContain('const STATIC_CACHE = "esc-static-v2";');
    // the offline page and the kept workout pages are unchanged
    expect(sw).toContain('c.match("/offline.html")');
    expect(sw).toContain('url.pathname.startsWith("/sessions/")');
  });
  it("B11: the email-change banner is streamed", () => {
    expect(read("app/(coach)/layout.tsx")).toMatch(/<Suspense fallback=\{null\}>\s*<PendingEmailChangeBanner/);
  });
});

describe("group 2", () => {
  it("B5: two components asking who this is at once share one call; a sign-out (or a refresh, a new sign-in, an account change) asks again; a token is always its own call; a failure is not kept", async () => {
    const { shareGetUser } = await import("@/lib/supabase/client");
    let calls = 0;
    let listener: ((event: string, session: unknown) => void) | null = null;
    let fail = false;
    const client = {
      auth: {
        getUser: async (jwt?: string) => {
          calls++;
          if (fail) return { data: { user: null }, error: { message: "offline" } };
          return { data: { user: { id: jwt ? "from-token" : "u1" } }, error: null };
        },
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          listener = cb;
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    };
    const c = shareGetUser(client);
    expect(shareGetUser(c)).toBe(c); // installed once
    const [a, b] = await Promise.all([c.auth.getUser(), c.auth.getUser()]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    await c.auth.getUser();
    expect(calls).toBe(1);
    listener!("INITIAL_SESSION", null);
    await c.auth.getUser();
    expect(calls).toBe(1);
    listener!("SIGNED_OUT", null);
    await c.auth.getUser();
    expect(calls).toBe(2);
    listener!("TOKEN_REFRESHED", null);
    await c.auth.getUser();
    expect(calls).toBe(3);
    await c.auth.getUser("some.jwt");
    expect(calls).toBe(4);
    listener!("USER_UPDATED", null);
    fail = true;
    await c.auth.getUser();
    await new Promise((r) => setTimeout(r, 0));
    fail = false;
    const after = await c.auth.getUser();
    expect(calls).toBe(6);
    expect(after.data.user?.id).toBe("u1");
  });
  it("B5: only the shared (not the cross-organization) client, and only in the browser", () => {
    const src = read("lib/supabase/client.ts");
    expect(src).toContain('return typeof window === "undefined" ? client : shareGetUser(client);');
    expect(src.indexOf("if (options.crossOrg)")).toBeLessThan(src.indexOf("shareGetUser(client)"));
  });
  it("B6: a page opened within a minute uses the last answer for the same organization; opening Spotlight always reads it; sign-out forgets it", async () => {
    const { readSpotNeedsCache, spotNeedsCacheEntry, SPOT_NEEDS_CACHE_KEY } = await import("@/lib/spot-needs");
    const data = { needsChoice: false, groupIds: ["g1"], timezone: "UTC", sessionsToCheck: [], next: null, open: null, notices: [], unreadMessages: 2, count: 2, newestAt: null };
    const t0 = 1_000_000;
    const raw = spotNeedsCacheEntry(data as never, "org1", t0);
    expect(readSpotNeedsCache(raw, "org1", t0 + 59_000)).toEqual(data);
    expect(readSpotNeedsCache(raw, "org1", t0 + 61_000)).toBeNull();
    expect(readSpotNeedsCache(raw, "org2", t0 + 1_000)).toBeNull();
    expect(readSpotNeedsCache("{not json", "org1", t0)).toBeNull();
    expect(readSpotNeedsCache(null, "org1", t0)).toBeNull();
    const hub = read("components/coach/mobile/coach-spot-hub.tsx");
    expect(hub).toContain("if (!opening) {");
    expect(hub).toContain("readSpotNeedsCache(window.sessionStorage.getItem(SPOT_NEEDS_CACHE_KEY), org, Date.now())");
    expect(read("components/group/sign-out-button.tsx")).toContain("window.sessionStorage.removeItem(SPOT_NEEDS_CACHE_KEY)");
    expect(SPOT_NEEDS_CACHE_KEY).toBe("spot-needs-cache-v1");
    expect(read("app/api/coach/spot-needs/route.ts")).toContain("await Promise.all([getActiveAnchor(supabase, user.id), supabase.from(\"profiles\").select(\"timezone\")");
  });
  it("B4: a phone never mounts the side panel or the chat tab, and never reads the desktop badges", () => {
    const shell = read("components/coach/coach-desktop-shell.tsx");
    expect(shell).toContain("{isDesktop === true && coachId && (\n          <ShellListPanel");
    expect(shell).toContain("{isDesktop === true && (\n        <div className=\"hidden lg:block\">\n          <CollectiveIntelligenceChat");
    expect((shell.match(/if \(isDesktop !== true\) return;/g) ?? []).length).toBe(3);
    // the phone's own Spotlight and tabs are unchanged
    expect(shell).toContain('<div className="lg:hidden">\n          <CoachSpotHub groupId={groupId} />');
  });
});
