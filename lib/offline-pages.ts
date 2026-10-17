// Workout pages kept by the service worker (public/sw.js) so a workout opened once can open again with no signal. On a shared phone they must not outlive the person's sign-in.
export function purgeOfflinePages(): void {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.controller?.postMessage({ type: "purge" });
    if (typeof caches !== "undefined") void caches.delete("esc-pages-v1");
  } catch {
    // nothing kept, nothing to clear
  }
}
