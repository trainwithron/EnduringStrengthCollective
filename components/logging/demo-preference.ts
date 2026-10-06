"use client";

import { useEffect, useState } from "react";

// A client who does not want exercise demos can turn them off in Settings (Ron, Oct 6: not forced on everyone). The choice is kept on this device, so it needs
// no database change and takes effect at once; storage can be unavailable (private window, blocked site data), in which case demos simply stay on.
const KEY = "demos-hidden";
const EVENT = "demos-hidden-changed";

export function readDemosHidden(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDemosHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // nothing to do: the choice just is not remembered
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useDemosHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const sync = () => setHidden(readDemosHidden());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return hidden;
}
