import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("Release K2: fits a phone", () => {
  it("the notifications page's coach shell is a slim top bar on a phone and the 240px sidebar returns from the lg breakpoint", () => {
    const shell = src("components/coach/coach-home-shell.tsx");
    expect(shell).toContain('<aside className="hidden lg:flex w-60');
    expect(shell).toContain('<header className="lg:hidden');
    expect(shell).toContain("px-4 py-6 lg:px-8 lg:py-8");
    expect(shell).toContain("min-w-0");
    // nothing the sidebar holds is lost on a phone: it all sits behind the menu button in the top bar
    expect(shell).toContain("<CoachHomeMobileMenu />");
    const menu = src("components/coach/coach-home-mobile-menu.tsx");
    for (const part of ["<ClientFinder", 'href="/notifications"', "<ExitDesktopModeButton", "<DownloadAppButton", "<SignOutButton", "w-11 h-11"]) expect(menu, part).toContain(part);
    // Escape closes it and returns focus to its button; Sign out is a 44px, normal-size target
    expect(menu).toContain('e.key === "Escape"');
    expect(menu).toContain("buttonRef.current?.focus()");
    expect(menu).toContain("[&_button]:min-h-11 [&_button]:text-sm");
  });
  it("the notification bell is mounted once, never in the phone bar and the sidebar together, and each bell has its own live channel", () => {
    const shell = src("components/coach/coach-home-shell.tsx");
    expect(shell).toContain('{!desktop && <HeaderNotificationBell placement="below" />}');
    expect(shell).toContain('{desktop && <HeaderNotificationBell placement="above" />}');
    expect((shell.match(/<HeaderNotificationBell/g) ?? []).length).toBe(2);
    expect(src("lib/use-is-desktop.ts")).toContain("(min-width: 1024px)");
    expect(src("components/athlete/notification-bell.tsx")).toContain("notifications:${viewerId}:${instanceId}");
  });
  it("the exercise library's tabs scroll sideways and its toolbar wraps instead of running off the screen", () => {
    expect(src("components/coach/exercise-library-tabs.tsx")).toContain("overflow-x-auto");
    expect(src("components/coach/exercise-library-tabs.tsx")).toContain("shrink-0 whitespace-nowrap");
    expect((src("components/coach/exercise-library-tabs.tsx").match(/role="tab"/g) ?? []).length).toBe(4);
    const list = src("components/coach/exercise-library-list.tsx");
    expect(list).toContain('className="flex flex-wrap items-center gap-3 mb-4"');
    expect(list).toContain("w-full sm:h-10 sm:w-64");
  });
  it("the packages table scrolls inside its own box", () => {
    expect(src("components/coach/desktop/package-manager.tsx")).toContain('<div className="overflow-x-auto">');
  });
  it("the small buttons a thumb has to hit are at least 44px", () => {
    for (const f of ["components/feed/clear-channel-button.tsx", "components/feed/feed-settings-button.tsx"]) expect(src(f), f).toContain("w-11 h-11");
    expect(src("components/feed/new-post-composer.tsx")).toContain('aria-label="Close" className="w-11 h-11');
    expect(src("components/athlete/acting-as-banner.tsx")).toContain("min-h-11");
    expect(src("components/session/complete-workout-button.tsx")).toContain('className="h-11 border border-steel/30');
  });
});
