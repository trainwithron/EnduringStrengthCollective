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
