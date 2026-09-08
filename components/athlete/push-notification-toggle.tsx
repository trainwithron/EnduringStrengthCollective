"use client";

import { useEffect, useState } from "react";
import {
  isPushSupported,
  getExistingPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";

export function PushNotificationToggle() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const ok = isPushSupported();
      setSupported(ok);
      if (ok) {
        const existing = await getExistingPushSubscription();
        if (!cancelled) setSubscribed(!!existing);
      }
      if (!cancelled) setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle() {
    setError(null);
    setBusy(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        await subscribeToPush();
        setSubscribed(true);
      }
    } catch {
      setError("Couldn't update notification settings — check your browser's notification permission.");
    }
    setBusy(false);
  }

  if (!supported) {
    return (
      <div>
        <p className="font-body text-sm mb-1">Push notifications</p>
        <p className="font-body text-xs text-steel">Not supported in this browser.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="font-body text-sm mb-1">Push notifications</p>
      <p className="font-body text-xs text-steel mb-2">
        Get notified when your coach reaches out — reminders, new programs, and more.
      </p>
      <button
        type="button"
        onClick={handleToggle}
        disabled={loading || busy}
        className={`h-9 px-4 font-body text-sm font-medium disabled:opacity-40 ${
          subscribed ? "border border-steel/30 text-steel" : "bg-rust text-graphite"
        }`}
      >
        {busy ? "Working…" : subscribed ? "Turn off" : "Turn on"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
