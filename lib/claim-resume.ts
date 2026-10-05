import { isPlaceholderEmail } from "./placeholder-email";

// A client the coach set up in advance signs in with their claim link, which then lands them on "choose your password". If they leave there
// (a call comes in, the phone dies), the link is already used and they still have a session but no password and only the placeholder address.
// Anywhere they go in the app next, they are sent back to finish: the same screen, nothing lost. Returns true when the request should be sent
// to /set-password.
export function shouldResumeClaim(email: string | null | undefined, pathname: string): boolean {
  return isPlaceholderEmail(email) && (pathname === "/groups" || pathname.startsWith("/groups/"));
}
