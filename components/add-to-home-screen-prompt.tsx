"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { isStandaloneDisplay } from "@/lib/pwa";

const DISMISSED_KEY = "esc-a2hs-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Shows a "put this on your home screen" banner so clients find the app
// again as an icon, not a bookmark buried in browser history. Android/Chrome
// gets a real one-tap install via the browser's own beforeinstallprompt
// event; iOS Safari has no such API at all, so it gets manual instructions
// instead — that's a platform limitation, not something a web app can
// route around.
export function AddToHomeScreenPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "other">("other");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // localStorage unavailable — just proceed, worst case the banner
      // can't be dismissed permanently this session.
    }
    if (isStandaloneDisplay()) return;

    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    setPlatform(isIos ? "ios" : "other");
    setVisible(true);

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Not remembered this session, but it stops showing for now either way.
    }
  }

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  }

  if (!visible) return null;

  return (
    // Deliberately NOT `fixed` — nearly every page here already has a
    // fixed-bottom action bar (Start Workout, Complete Workout, Sign in),
    // and a fixed-top banner would overlay every page's own header instead
    // (back link, title). Rendered first in the document, a normal-flow
    // block at the top just pushes everything else down, no coordination
    // with individual pages needed.
    <div className="relative z-10 bg-surface border-b border-steel/30 px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-medium text-chalk">
          Add this to your home screen
        </p>
        <p className="font-body text-xs text-steel mt-0.5">
          {deferredPrompt
            ? "Get one-tap access, just like an app."
            : platform === "ios"
            ? "Tap the Share icon, then \"Add to Home Screen.\""
            : "Open your browser menu and choose \"Add to Home Screen\" or \"Install app.\""}
        </p>
      </div>
      {deferredPrompt && (
        <button
          type="button"
          onClick={handleInstallClick}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium shrink-0"
        >
          Install
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="w-9 h-9 flex items-center justify-center text-steel active:text-rust transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
