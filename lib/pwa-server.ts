import { cookies, headers } from "next/headers";
import { PWA_STANDALONE_COOKIE, VIEW_OVERRIDE_COOKIE, type ViewOverride } from "./pwa";

// Server-side read of the cookie PwaContextCookie writes client-side.
// True only when the CURRENT request was launched from the installed
// home-screen app; the same coach opening a normal browser tab on the
// very same phone gets false, since the cookie is re-written fresh on
// every load.
export async function isPwaStandalone(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(PWA_STANDALONE_COOKIE)?.value === "1";
}

// A real phone browser tab, not just the installed app — coaches
// overwhelmingly open this from their phone before ever installing it,
// and the dense desktop coaching shell shouldn't be their first
// impression. Matches the same platforms AddToHomeScreenPrompt already
// distinguishes client-side (iOS/Android), server-side.
async function isMobileUserAgent(): Promise<boolean> {
  const headerStore = await headers();
  const ua = headerStore.get("user-agent") ?? "";
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

// Real device signal only, deliberately ignoring VIEW_OVERRIDE_COOKIE —
// for the one or two pages (like /dashboard) that have exactly ONE
// layout and it's a fixed desktop sidebar, not a genuine dual-shell page
// the way /groups/[groupId] is. The sticky override's whole meaning is
// "which of these two valid shells do you want," which is a category
// error to apply somewhere only one shell exists at all: a coach who
// flipped "Desktop Mode" on to preview their OWN group hub would
// otherwise also get stuck seeing a broken, unusable sidebar on a page
// that was never built to render on a phone either way. Use
// prefersAthleteStyleView() for anywhere a real mobile-style alternative
// actually exists; use this where it doesn't.
export async function isRealMobileDevice(): Promise<boolean> {
  const [standalone, mobile] = await Promise.all([isPwaStandalone(), isMobileUserAgent()]);
  return standalone || mobile;
}

// The coach's own manual, sticky shell choice (see lib/pwa.ts for why
// this lives in its own cookie, separate from PWA_STANDALONE_COOKIE).
// null means "no explicit choice yet — auto-detect".
export async function getViewOverride(): Promise<ViewOverride> {
  const cookieStore = await cookies();
  const value = cookieStore.get(VIEW_OVERRIDE_COOKIE)?.value;
  return value === "desktop" || value === "mobile" ? value : null;
}

// Whether a coach should see the lighter, client-style app (bottom tab
// bar, today's workout, roster) instead of the full desktop coaching
// shell. An explicit override (the tablet-mode toggle) always wins and
// is never gated on device — a coach on a tablet who wants the full
// desktop shell for planning, or the client-facing shell while standing
// with a client, gets exactly that regardless of viewport. With no
// override, falls back to auto-detect: true once they're either on a
// phone at all, or have installed the app. A coach at an actual
// desktop/laptop with no override always gets the full shell.
export async function prefersAthleteStyleView(): Promise<boolean> {
  const override = await getViewOverride();
  if (override) return override === "mobile";

  const [standalone, mobile] = await Promise.all([isPwaStandalone(), isMobileUserAgent()]);
  return standalone || mobile;
}
