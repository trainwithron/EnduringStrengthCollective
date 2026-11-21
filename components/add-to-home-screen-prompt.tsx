"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { isStandaloneDisplay } from "@/lib/pwa";
import { detectPlatform, type DevicePlatform } from "@/lib/first-run-guide";
import {
  getDeferredInstallPrompt,
  isGuideActive,
  runInstallPrompt,
  startInstallPromptCapture,
  subscribeInstallPrompt,
} from "@/lib/install-prompt-store";

const DISMISSED_KEY = "esc-a2hs-dismissed";

function installHint(hasDeferred: boolean, platform: DevicePlatform): string {
  return hasDeferred
    ? "Get one-tap access, just like an app."
    : platform === "ios-safari"
    ? "In Safari, tap the Share icon, then \"Add to Home Screen.\""
    : platform === "ios-other"
    ? "Open this page in Safari first. Only Safari can add apps to an iPhone home screen."
    : "Open your browser menu and choose \"Add to Home Screen\" or \"Install app.\"";
}

// Only offered inside the signed-in app. On the landing page, login or an
// invite link it is a distraction before the person has even joined.
const SIGNED_IN_PREFIXES = ["/groups", "/dashboard", "/sessions", "/partners"];

// Shows a "put this on your home screen" banner so clients find the app
// again as an icon, not a bookmark buried in browser history. Android/Chrome
// gets a real one-tap install via the browser's own beforeinstallprompt
// event; iOS Safari has no such API at all, so it gets manual instructions
// instead — that's a platform limitation, not something a web app can
// route around. While the first-run guide card is on screen it does this job,
// so the banner steps aside.
export const SPOTLIGHT_SELECTOR = 'button[aria-label="Spotlight"]';
// A client's Home shows the banner below its main content instead of at the top (Look Refresh, client step, Ron Nov 20): Home renders its own copy with
// slot="home", and the one at the top of every page steps aside while that copy is on the page. Dismissing either dismisses both.
export const HOME_SLOT_SELECTOR = "[data-a2hs-home-slot]";

export function AddToHomeScreenPrompt({ slot = "top" }: { slot?: "top" | "home" } = {}) {
  const pathname = usePathname();
  const inApp = slot === "home" || SIGNED_IN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const [visible, setVisible] = useState(false);
  const [homeSlotOn, setHomeSlotOn] = useState(false);
  useEffect(() => {
    if (slot !== "top") return;
    const check = () => {
      setHomeSlotOn(!!document.querySelector(HOME_SLOT_SELECTOR));
      // Dismissed on Home's copy: stays dismissed here too.
      try {
        if (localStorage.getItem(DISMISSED_KEY)) setVisible(false);
      } catch {
        // storage blocked: nothing remembered either way
      }
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [slot, pathname]);
  const [platform, setPlatform] = useState<DevicePlatform>("desktop");
  const [hasDeferred, setHasDeferred] = useState(false);
  const [guideOn, setGuideOn] = useState(false);
  // The coach's Spotlight button is fixed at the top centre (12 to 52px down) on every coach phone page: while it is on the page the banner starts below it, so it never covers it.
  const [spotlightOn, setSpotlightOn] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const check = () => setSpotlightOn(!!document.querySelector(SPOTLIGHT_SELECTOR));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [visible, pathname]);

  useEffect(() => {
    startInstallPromptCapture();
    const sync = () => {
      setHasDeferred(!!getDeferredInstallPrompt());
      setGuideOn(isGuideActive());
    };
    sync();
    const unsubscribe = subscribeInstallPrompt(sync);

    try {
      if (localStorage.getItem(DISMISSED_KEY)) return unsubscribe;
    } catch {
      // localStorage unavailable — just proceed, worst case the banner
      // can't be dismissed permanently this session.
    }
    if (isStandaloneDisplay()) return unsubscribe;

    const detected = detectPlatform(window.navigator.userAgent);
    // Only on a phone or tablet: a computer has no home screen to add this to.
    if (detected === "desktop") return unsubscribe;
    setPlatform(detected);
    setVisible(true);
    return unsubscribe;
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
    await runInstallPrompt();
    dismiss();
  }

  if (slot === "home") {
    // Always leaves its marker, so the top banner knows Home has its own place for it; shows only when the banner would.
    return (
      <div data-a2hs-home-slot>
        {visible && !guideOn && (
          <div role="region" aria-label="Add to home screen" className="lg:hidden bg-surface rounded-card border border-steel/30 pl-4 pr-2 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-semibold text-chalk">Add this to your home screen</p>
              <p className="font-body text-xs text-steel mt-0.5">{installHint(hasDeferred, platform)}</p>
            </div>
            {hasDeferred && (
              <button type="button" onClick={handleInstallClick} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium shrink-0">
                Install
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="w-11 h-11 flex items-center justify-center text-steel active:text-rust-ink transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!visible || !inApp || guideOn || homeSlotOn) return null;

  return (
    // Deliberately NOT `fixed` — nearly every page here already has a
    // fixed-bottom action bar (Start Workout, Complete Workout, Sign in),
    // and a fixed-top banner would overlay every page's own header instead
    // (back link, title). Rendered first in the document, a normal-flow
    // block at the top just pushes everything else down, no coordination
    // with individual pages needed.
    <div
      role="region"
      aria-label="Add to home screen"
      className={`relative z-10 lg:hidden bg-surface border-b border-steel/30 pl-4 pr-16 py-3 flex items-start gap-3 ${spotlightOn ? "mt-14 border-t" : ""}`}
      data-below-spotlight={spotlightOn || undefined}
    >
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-medium text-chalk">
          Add this to your home screen
        </p>
        <p className="font-body text-xs text-steel mt-0.5">{installHint(hasDeferred, platform)}</p>
      </div>
      {hasDeferred && (
        <button
          type="button"
          onClick={handleInstallClick}
          className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium shrink-0"
        >
          Install
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="w-11 h-11 flex items-center justify-center text-steel active:text-rust-ink transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
