// Shared client-side "is this running as an installed app" check — used
// both by the install-prompt banner and by the coach/athlete mobile-view
// routing below. Guarded for SSR since it touches window/navigator.
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag — not covered by the standard media query.
    (window.navigator as any).standalone === true
  );
}

// A real phone browser tab, not just the installed app — mirrors
// lib/pwa-server.ts's isMobileUserAgent for the one place (login redirect)
// that decides where to send a coach before any server render happens.
export function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

export const PWA_STANDALONE_COOKIE = "pwa_standalone";

// A coach's own manual, sticky choice of which shell to see — separate
// from PWA_STANDALONE_COOKIE on purpose. PwaContextCookie re-asserts the
// auto-detected standalone/browser-tab state on every navigation and tab
// focus (that's the multi-tab fix from e934125); if this override lived
// in that same cookie, that same re-assertion would silently clobber it
// the moment any tab re-navigated, defeating "sticky". Keeping it in its
// own cookie means the two mechanisms never touch each other:
// prefersAthleteStyleView() checks this one first and only falls back to
// the auto-detected value when no override is set.
export const VIEW_OVERRIDE_COOKIE = "coach_view_override";
export type ViewOverride = "desktop" | "mobile" | null;

// null clears the override (back to auto-detect). This is a deliberate,
// explicit choice — not device-gated — so it's written the same way
// regardless of what device/viewport the coach is on.
export function writeViewOverride(mode: ViewOverride): void {
  if (typeof document === "undefined") return;
  if (mode === null) {
    document.cookie = `${VIEW_OVERRIDE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } else {
    document.cookie = `${VIEW_OVERRIDE_COOKIE}=${mode}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }
}

// Re-evaluated on every page load (see PwaContextCookie) so the same
// physical device correctly reports differently depending on how THIS
// load was launched — from the home-screen icon (standalone) vs a normal
// browser tab, even for the same user in the same session.
export function writeStandaloneCookie(): void {
  if (typeof document === "undefined") return;
  const value = isStandaloneDisplay() ? "1" : "0";
  document.cookie = `${PWA_STANDALONE_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
