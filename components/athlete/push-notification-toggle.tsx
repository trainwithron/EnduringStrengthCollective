"use client";

import { useState } from "react";
import { usePushStatus } from "@/lib/use-push-status";
import { sendTestPush } from "@/lib/push-client";
import { isStandaloneDisplay } from "@/lib/pwa";
import { detectPlatform } from "@/lib/first-run-guide";

export type PushVariant = "settings" | "card" | "tile" | "chip";

// The one push control. Settings, the first-run card, the Home chip and the
// coach hub tile are all this component in different sizes, so the states,
// the wording and the behaviour are written once.
export function PushNotificationToggle({
  variant = "settings",
  profileId,
  onEnabled,
  audience = "client",
}: {
  variant?: PushVariant;
  // A coach reads the settings page too, so the words are not written only for a client on a phone.
  audience?: "client" | "coach";
  // Needed to send the "it works" test push after turning on.
  profileId?: string;
  onEnabled?: () => void;
}) {
  const { state, busy, error, enable, disable } = usePushStatus();
  const [tested, setTested] = useState<"idle" | "sent" | "none">("idle");

  async function handleEnable() {
    const ok = await enable();
    if (!ok) return;
    onEnabled?.();
    if (profileId) {
      const delivered = await sendTestPush(profileId);
      setTested(delivered ? "sent" : "none");
    }
  }

  const isIos = typeof navigator !== "undefined" && detectPlatform(navigator.userAgent).startsWith("ios");
  const needsInstall = isIos && typeof window !== "undefined" && !isStandaloneDisplay();

  // ---- chip: only shows when notifications are off and could be turned on now ----
  if (variant === "chip") {
    if (state !== "off" || needsInstall) return null;
    return (
      <div className="px-5 pt-4">
        <button
          type="button"
          onClick={handleEnable}
          disabled={busy}
          className="h-11 px-4 inline-flex items-center border border-amber/60 text-amber font-body text-sm disabled:opacity-50"
        >
          {busy ? "Turning on…" : "Turn on notifications"}
        </button>
      </div>
    );
  }

  // ---- tile: coach hub; shows only while off ----
  if (variant === "tile") {
    if (state === "loading" || state === "on" || state === "unsupported") return null;
    return (
      <div className="border border-amber/50 bg-surface/60 px-4 py-3">
        <p className="font-body text-sm text-chalk">Turn on notifications</p>
        <p className="font-body text-xs text-steel mt-0.5">
          Get new messages, low-readiness flags and your daily summary on this phone.
        </p>
        {state === "denied" ? (
          <p className="font-body text-xs text-steel mt-2">
            Notifications are blocked for this app. Turn them on in your phone&apos;s settings.
          </p>
        ) : needsInstall ? (
          <p className="font-body text-xs text-steel mt-2">
            Add this app to your home screen first. Notifications work from the home-screen app.
          </p>
        ) : (
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy}
            className="h-11 px-5 mt-2 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Turning on…" : "Turn on"}
          </button>
        )}
        {error && (
          <p className="font-body text-xs text-rust mt-2" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ---- card + settings share the same states and wording ----
  if (state === "loading") {
    return <p className="font-body text-xs text-steel">Checking notifications…</p>;
  }

  if (state === "unsupported") {
    return (
      <div>
        <p className="font-body text-sm mb-1">Push notifications</p>
        <p className="font-body text-xs text-steel">
          {needsInstall
            ? "On iPhone, notifications work from the home-screen app. Add this app to your home screen, open it from there, then come back here."
            : "This browser can't receive notifications."}
        </p>
      </div>
    );
  }

  const on = state === "on";
  const big = variant === "card";

  return (
    <div>
      {!big && <p className="font-body text-sm mb-1">Push notifications</p>}
      {!big && (
        <p className="font-body text-xs text-steel mb-2">
          {audience === "coach" ? "Get notified about client messages, bookings and your daily summary." : "Get notified when your coach reaches out — reminders, new programs, and more."}
        </p>
      )}

      {state === "denied" ? (
        <p className="font-body text-xs text-steel" role="status">
          {audience === "coach"
            ? "Notifications are blocked for this site. Allow them in your browser's site settings (or your device's notification settings), then come back."
            : "Notifications are blocked for this app. Turn them on in your phone's settings (Settings, then Notifications, then this app), then come back."}
        </p>
      ) : needsInstall && !on ? (
        <p className="font-body text-xs text-steel" role="status">
          Add this app to your home screen first, then open it from there. iPhone only sends notifications to
          the home-screen app.
        </p>
      ) : (
        <button
          type="button"
          onClick={on ? disable : handleEnable}
          disabled={busy}
          className={`h-11 px-5 font-body text-sm font-medium disabled:opacity-40 ${
            on ? "border border-steel/30 text-steel" : "bg-rust text-graphite"
          } ${big ? "w-full" : ""}`}
        >
          {busy ? "Working…" : on ? "Turn off" : "Turn on notifications"}
        </button>
      )}

      {on && tested === "sent" && (
        <p className="font-body text-xs text-positive mt-2" role="status">
          Done. We just sent you a test notification.
        </p>
      )}
      {on && tested === "none" && (
        <p className="font-body text-xs text-steel mt-2" role="status">
          Notifications are on. The test message hasn&apos;t shown up yet, but real ones will.
        </p>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
