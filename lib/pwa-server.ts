import { cookies } from "next/headers";
import { PWA_STANDALONE_COOKIE } from "./pwa";

// Server-side read of the cookie PwaContextCookie writes client-side.
// True only when the CURRENT request was launched from the installed
// home-screen app; the same coach opening a normal browser tab on the
// very same phone gets false, since the cookie is re-written fresh on
// every load.
export function isPwaStandalone(): boolean {
  return cookies().get(PWA_STANDALONE_COOKIE)?.value === "1";
}
