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

export const PWA_STANDALONE_COOKIE = "pwa_standalone";

// Re-evaluated on every page load (see PwaContextCookie) so the same
// physical device correctly reports differently depending on how THIS
// load was launched — from the home-screen icon (standalone) vs a normal
// browser tab, even for the same user in the same session.
export function writeStandaloneCookie(): void {
  if (typeof document === "undefined") return;
  const value = isStandaloneDisplay() ? "1" : "0";
  document.cookie = `${PWA_STANDALONE_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
