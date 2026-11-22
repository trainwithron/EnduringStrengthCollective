import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

// Ron, Oct 23: "there's not a way to clear notifications from the spot. And I have two different notification bells" and, on a 412px Galaxy, "the left side of the notifications
// are off of the screen".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("notices are cleared in the bell (PH14: Spotlight's Waiting for you no longer lists them)", () => {
  it("Waiting for you shows no notices and no Mark all read; the bell keeps its own Mark all read", async () => {
    const { SpotNeedsTop } = await import("@/components/coach/mobile/spot-needs-top");
    const base = { needsChoice: false, groupIds: [], timezone: "UTC", sessionsToCheck: [], next: null, open: null, requestsWaiting: 0, checkinsToReview: 0, count: 0, newestAt: null };
    const html = renderToStaticMarkup(createElement(SpotNeedsTop, { needs: { ...base, notices: [{ id: "n1", body: "Ann logged a workout", linkPath: "/x" }] } as never, onNavigated: () => {} }));
    expect(html).not.toContain("Mark all read");
    expect(html).not.toContain("Ann logged a workout");
    const top = read("components/coach/mobile/spot-needs-top.tsx");
    expect(top).not.toContain("needs.notices");
    expect(read("components/athlete/notification-bell.tsx")).toContain("Mark all read");
  });
  it("a coach looking at any client app (their own or a client's) has no separate bell on a phone; the computer keeps it", () => {
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain("bellOnComputerOnly={isActingAsOther}");
    expect(read("components/group/group-hub-header.tsx")).toContain('<span className="hidden lg:inline-flex" data-bell-computer-only>');
  });
});

describe("the bell's panel fits a phone", () => {
  it("on a phone it spans the screen with a margin; from the small-screen width up it opens beside the bell", () => {
    const bell = read("components/athlete/notification-bell.tsx");
    expect(bell).toContain("fixed left-3 right-3 z-50 max-h-[70vh] overflow-y-auto");
    expect(bell).toContain("sm:absolute sm:w-80");
    expect(bell).not.toContain("absolute z-50 w-80 max-w-[85vw]");
  });
});
