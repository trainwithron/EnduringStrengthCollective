import { cookies, headers } from "next/headers";
import { PWA_STANDALONE_COOKIE } from "./pwa";

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

// Whether a coach should see the lighter, client-style app (bottom tab
// bar, today's workout, roster) instead of the full desktop coaching
// shell — true once they're either on a phone at all, or have installed
// it. A coach at an actual desktop/laptop always gets the full shell.
export async function prefersAthleteStyleView(): Promise<boolean> {
  const [standalone, mobile] = await Promise.all([isPwaStandalone(), isMobileUserAgent()]);
  return standalone || mobile;
}
