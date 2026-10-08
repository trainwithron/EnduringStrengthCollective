import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\r\n/g, "\n");
const page = read("../app/(coach)/groups/[groupId]/messages/[otherId]/page.tsx");
const section = read("../components/coach/desktop/client-messages-section.tsx");
const profile = read("../app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
const tabs = read("../components/coach/desktop/client-profile-tabs.tsx");

describe("a coach on a computer has no separate message page", () => {
  it("the old address redirects to the client's Messages tab", () => {
    expect(page).toContain("if (viewerIsCoach && !showMobileView) {");
    expect(page).toContain("redirect(`/groups/${params.groupId}/athletes/${params.otherId}?tab=messages${draft}`);");
  });
  it("the redirect comes after the pairing is checked (only a real athlete of this group) and before the thread is loaded or marked read", () => {
    const guard = page.indexOf("notFound();");
    const redirectAt = page.indexOf("redirect(`/groups/${params.groupId}/athletes/");
    const load = page.indexOf("loadDirectThread(");
    expect(guard).toBeGreaterThan(-1);
    expect(redirectAt).toBeGreaterThan(guard);
    expect(redirectAt).toBeLessThan(load);
  });
  it("a drafted note (expiry check-in, come-back note) rides along to the tab", () => {
    expect(page).toContain("encodeURIComponent(initialDraft)");
    expect(profile).toContain("draft?: string");
    expect(profile).toContain('.slice(0, 600)');
    expect(profile).toContain("initialDraft={draftParam}");
    expect(section).toContain("initialDraft={initialDraft}");
  });
  it("the tab no longer links to a page that would redirect right back", () => {
    expect(section).not.toContain("Open on its own page");
    expect(section).not.toContain("/messages/${");
  });
  it("the phone and the client keep their own page (only a coach on a computer is redirected)", () => {
    expect(page).toContain("<BottomTabBar");
    expect(page).toContain("fixedComposer");
    expect(page).not.toContain("CoachDesktopShell");
  });
  it("the redirect is a server redirect, so Back returns to where the coach came from instead of trapping", () => {
    // redirect() sends the browser on without adding the old address to its history
    expect(page).toContain('import { redirect, notFound } from "next/navigation";');
    expect(page).not.toContain("window.location");
    expect(page).not.toContain("router.replace");
  });
  it("leaving the Messages tab still closes the conversation by address, so a hidden thread never marks new messages read", () => {
    expect(tabs).toContain("router.push");
    expect(tabs).toContain("router.push");
    expect(profile).toContain('initialTab === "messages" && <ClientMessagesSection');
  });
});
