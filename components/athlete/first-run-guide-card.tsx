"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Share } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { isStandaloneDisplay } from "@/lib/pwa";
import {
  computeGuideSteps,
  detectPlatform,
  isGuideComplete,
  type DevicePlatform,
} from "@/lib/first-run-guide";
import {
  getDeferredInstallPrompt,
  runInstallPrompt,
  setGuideActive,
  startInstallPromptCapture,
  subscribeInstallPrompt,
} from "@/lib/install-prompt-store";
import { usePushStatus } from "@/lib/use-push-status";
import { PushNotificationToggle } from "./push-notification-toggle";

// Per person, so one person closing the guide on a shared phone does not hide it for the next person who signs in.
const localDismissKey = (profileId: string) => `esc-first-run-guide-dismissed-${profileId}`;

function readLocalDismissed(profileId: string): boolean {
  try {
    return localStorage.getItem(localDismissKey(profileId)) === "1";
  } catch {
    return false;
  }
}

// The two things a new client needs on their phone: the app on the home screen,
// then notifications. Shown once on Home, above Today, until both are done or the
// client says "Not now". Everything is read live from the device, so it never
// shows a step that is already finished.
export function FirstRunGuideCard({
  profileId,
  serverDismissed,
  scrollIntoView = false,
}: {
  profileId: string;
  serverDismissed: boolean;
  scrollIntoView?: boolean;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(serverDismissed);
  const [platform, setPlatform] = useState<DevicePlatform>("desktop");
  const [standalone, setStandalone] = useState(false);
  const [canInstallNow, setCanInstallNow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sawIncomplete, setSawIncomplete] = useState(false);
  const push = usePushStatus();

  useEffect(() => {
    setMounted(true);
    setPlatform(detectPlatform(navigator.userAgent));
    setStandalone(isStandaloneDisplay());
    if (readLocalDismissed(profileId)) setDismissed(true);
    startInstallPromptCapture();
    const sync = () => setCanInstallNow(!!getDeferredInstallPrompt());
    sync();
    return subscribeInstallPrompt(sync);
  }, []);

  const steps = computeGuideSteps({ platform, standalone, push: push.state });
  const complete = push.state !== "loading" && isGuideComplete(steps);
  const visible = mounted && !dismissed && push.state !== "loading" && !(complete && !sawIncomplete);

  // The thin install banner steps aside while this card is the install prompt.
  useEffect(() => {
    setGuideActive(visible);
    return () => setGuideActive(false);
  }, [visible]);

  useEffect(() => {
    if (mounted && push.state !== "loading" && !complete) setSawIncomplete(true);
  }, [mounted, push.state, complete]);

  useEffect(() => {
    if (visible && scrollIntoView) rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(localDismissKey(profileId), "1");
    } catch {
      // Not remembered on this device; the server copy below still is.
    }
    // Follows the client across devices. If the column isn't there yet this just fails quietly
    // and the device-level flag above does the job.
    try {
      const supabase = createBrowserClient();
      await supabase.from("profiles").update({ guide_dismissed_at: new Date().toISOString() }).eq("id", profileId);
    } catch {
      // ignore
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!visible) return null;

  const install = steps.find((s) => s.key === "install")!;
  const notifications = steps.find((s) => s.key === "notifications")!;

  return (
    <section
      id="get-set-up"
      ref={rootRef}
      aria-label="Get set up"
      className="mx-5 mt-6 border border-steel/30 bg-surface/60 px-4 py-4"
    >
      {complete ? (
        <div>
          <p className="font-display uppercase text-lg font-bold leading-none">You&apos;re all set</p>
          <p className="font-body text-sm text-steel mt-2">
            The app is on your phone and your coach&apos;s messages will reach you.
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="h-11 px-5 mt-3 bg-rust text-graphite font-body text-sm font-medium"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <p className="font-display uppercase text-lg font-bold leading-none">Get set up</p>
          <p className="font-body text-sm text-steel mt-1.5">
            {install.status === "hidden" ? "One quick step" : "Two quick steps"} so your coach can reach you.
          </p>

          {install.status !== "hidden" && (
            <div className="mt-4">
              <StepHeading n={1} title="Add this app to your home screen" done={install.status === "done"} />
              {install.status === "todo" && (
                <div className="mt-2 pl-9 font-body text-sm text-chalk space-y-1.5">
                  {platform === "ios-safari" && (
                    <>
                      <p>
                        Tap the Share icon <Share className="inline w-4 h-4 -mt-0.5 text-rust" aria-label="Share" /> at
                        the bottom of Safari.
                      </p>
                      <p>Scroll down and tap &ldquo;Add to Home Screen&rdquo;.</p>
                      <p>Open the new icon on your home screen and sign in once inside it. The Home Screen app doesn&apos;t share your sign-in from Safari. Then finish step 2 there.</p>
                    </>
                  )}
                  {platform === "ios-other" && (
                    <>
                      <p>
                        Open this page in <strong className="font-medium">Safari</strong> first. Only Safari can add an
                        app to an iPhone home screen.
                      </p>
                      <button
                        type="button"
                        onClick={copyLink}
                        className="h-11 px-4 border border-steel/30 text-chalk font-body text-sm"
                      >
                        {copied ? "Link copied. Paste it in Safari." : "Copy link"}
                      </button>
                    </>
                  )}
                  {platform === "android" &&
                    (canInstallNow ? (
                      <button
                        type="button"
                        onClick={() => void runInstallPrompt()}
                        className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium"
                      >
                        Install the app
                      </button>
                    ) : (
                      <p>Open your browser menu (the three dots) and tap &ldquo;Install app&rdquo; or &ldquo;Add to Home screen&rdquo;.</p>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-4">
            <StepHeading
              n={install.status === "hidden" ? 1 : 2}
              title="Turn on notifications"
              done={notifications.status === "done"}
            />
            <div className="mt-2 pl-9">
              {notifications.status === "blocked" && notifications.reason === "needs-install" ? (
                <p className="font-body text-sm text-steel">
                  Do step 1 first. On iPhone, notifications switch on from the home-screen app.
                </p>
              ) : (
                <PushNotificationToggle variant="card" profileId={profileId} onEnabled={() => void push.refresh()} />
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="h-11 mt-3 font-body text-sm text-steel active:text-rust"
          >
            Not now
          </button>
        </>
      )}
    </section>
  );
}

function StepHeading({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center font-body text-xs font-medium ${
          done ? "bg-positive text-graphite" : "border border-steel/50 text-chalk"
        }`}
        aria-hidden="true"
      >
        {done ? <Check className="w-3.5 h-3.5" /> : n}
      </span>
      <p className={`font-body text-sm font-medium ${done ? "text-steel line-through" : "text-chalk"}`}>
        <span className="sr-only">{`Step ${n}: `}</span>
        {title}
        {done && <span className="sr-only"> (done)</span>}
      </p>
    </div>
  );
}
