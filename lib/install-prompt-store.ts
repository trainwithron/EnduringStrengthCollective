// Android Chrome fires `beforeinstallprompt` once, early, and only to whoever
// is already listening. The install banner lives in the root layout and so
// hears it first; this small store lets the first-run card use the same event
// instead of missing it. Browser-only.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let started = false;
let guideActive = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function startInstallPromptCapture() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
}

export function getDeferredInstallPrompt() {
  return deferred;
}

export async function runInstallPrompt(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  notify();
  return choice.outcome === "accepted";
}

// While the first-run card is on screen it is the one install prompt; the thin
// banner steps aside so there are not two.
export function setGuideActive(active: boolean) {
  guideActive = active;
  notify();
}

export function isGuideActive() {
  return guideActive;
}

export function subscribeInstallPrompt(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
