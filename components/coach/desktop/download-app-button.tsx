"use client";

import { useEffect, useState } from "react";
import { Smartphone, X, Copy, Check } from "lucide-react";

// A coach building programs is sitting at a desktop, not their phone — the
// browser's own beforeinstallprompt flow (used by the one-time
// AddToHomeScreenPrompt banner elsewhere in this app) can't help them get
// the app onto their phone from here. This is a persistent sidebar entry
// point instead: it just tells them what to do on the phone itself
// (visit this URL, then the platform's own "Add to Home Screen" step) —
// and once they're logged in there, they automatically land on the same
// athlete-style mobile experience as any client, per the PWA-detection
// routing already built.
export function DownloadAppButton({
  collapsed = false,
  variant = "sidebar",
}: {
  collapsed?: boolean;
  variant?: "sidebar" | "topbar";
}) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked — the URL is still shown on screen to copy by hand.
    }
  }

  return (
    <>
      {variant === "topbar" ? (
        // Pinned in the persistent top bar — this exists specifically
        // because the sidebar entry below is easy to miss on a phone (it's
        // the last item in a long scrollable list, and the one-time
        // install banner dismisses itself and doesn't come back). This
        // one never moves and never goes away.
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Get the app on your phone"
          aria-label="Get the app on your phone"
          className="w-9 h-9 flex items-center justify-center text-steel active:text-rust transition-colors shrink-0"
        >
          <Smartphone className="w-[18px] h-[18px]" strokeWidth={2.25} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={collapsed ? "Download App" : undefined}
          className={`w-full flex items-center gap-3 h-11 font-body text-sm text-steel active:text-chalk transition-colors ${
            collapsed ? "justify-center px-2" : "px-5"
          }`}
        >
          <Smartphone className="w-4 h-4 shrink-0" strokeWidth={2.25} />
          {!collapsed && "Download App"}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-graphite/80 flex items-center justify-center px-6">
          <div className="bg-surface border border-steel/30 max-w-md w-full p-6 relative">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-steel active:text-rust transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <h2 className="font-display font-bold text-xl uppercase leading-none">
              Get the app on your phone
            </h2>
            <p className="font-body text-sm text-steel mt-3">
              This is a web app, not an app-store download — installing it just
              means saving this site to your home screen, so it opens full-screen
              like any other app.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <div className="flex-1 h-10 bg-graphite border border-steel/30 px-3 flex items-center overflow-hidden">
                <span className="font-body text-xs text-chalk truncate">{origin}</span>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="h-10 px-3 border border-steel/30 text-steel active:border-rust active:text-rust transition-colors shrink-0 flex items-center gap-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="font-body text-xs">{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <p className="font-body text-xs text-rust uppercase tracking-wide font-medium">
                  On an iPhone
                </p>
                <p className="font-body text-sm text-chalk mt-1">
                  Open that link in Safari, tap the Share icon, then &quot;Add to Home Screen.&quot;
                </p>
              </div>
              <div>
                <p className="font-body text-xs text-rust uppercase tracking-wide font-medium">
                  On Android
                </p>
                <p className="font-body text-sm text-chalk mt-1">
                  Open that link in Chrome, tap the menu (⋮), then &quot;Add to Home Screen&quot; or
                  &quot;Install app.&quot;
                </p>
              </div>
            </div>

            <p className="font-body text-xs text-steel mt-5 pt-4 border-t border-steel/15">
              Once it&apos;s installed and you sign in from the home-screen icon, you&apos;ll
              see the same client-style app your athletes use — for logging your own
              training. Admin tools like this one still only show up in a regular
              browser tab.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
