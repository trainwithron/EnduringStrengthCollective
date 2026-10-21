import { cookies, headers } from "next/headers";
import { PWA_STANDALONE_COOKIE, VIEW_OVERRIDE_COOKIE, type ViewOverride } from "./pwa";
import { isPhoneView, isTabletUA } from "./phone-coach-routes";

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
export async function isMobileUserAgent(): Promise<boolean> {
  const headerStore = await headers();
  const ua = headerStore.get("user-agent") ?? "";
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
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
// override, falls back to auto-detect: true on a phone or tablet (the
// installed app on a computer is a computer, Oct 21). A coach at an actual
// desktop/laptop with no override always gets the full shell.
// The rule itself is lib/phone-coach-routes.ts isPhoneView, the same one the middleware uses to send a phone to the phone app's places.
export async function prefersAthleteStyleView(): Promise<boolean> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return isPhoneView({
    override: cookieStore.get(VIEW_OVERRIDE_COOKIE)?.value,
    userAgent: headerStore.get("user-agent"),
  });
}

// A tablet chose its layout on purpose (the tablet switch), so it is never "stuck in desktop mode" (server side: the user agent only; iPadOS as a Mac is not visible here and needs no banner).
export async function isTabletUserAgent(): Promise<boolean> {
  return isTabletUA((await headers()).get("user-agent"));
}
