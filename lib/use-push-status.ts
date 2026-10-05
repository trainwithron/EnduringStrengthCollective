"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isPushSupported,
  getExistingPushSubscription,
  getPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";
import type { PushState } from "@/lib/first-run-guide";

// One place that knows whether this device gets push, and can switch it on or
// off. The first-run card, the Settings toggle, the Home chip and the coach hub
// tile all use this, so they can never disagree.
export function usePushStatus() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }
    if (getPushPermission() === "denied") {
      setState("denied");
      return;
    }
    const existing = await getExistingPushSubscription();
    setState(existing ? "on" : "off");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Must run inside a tap: the permission prompt only appears for a user gesture.
  const enable = useCallback(async (): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      await subscribeToPush();
      await refresh();
      setBusy(false);
      return true;
    } catch {
      await refresh();
      setError(
        getPushPermission() === "denied"
          ? "Notifications are blocked for this app. Turn them on in your phone's settings, then come back."
          : "Couldn't turn notifications on. Check your connection and try again."
      );
      setBusy(false);
      return false;
    }
  }, [refresh]);

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await unsubscribeFromPush();
    } catch {
      setError("Couldn't turn notifications off. Try again.");
    }
    await refresh();
    setBusy(false);
  }, [refresh]);

  return { state, busy, error, enable, disable, refresh };
}
