"use client";

import { useEffect } from "react";

// Counts one scan of this QR page (Ron, Nov 20: M2): once the page has opened in a browser, it tells the server (app/api/public/scan), which counts it anonymously. An exercise opened
// from a machine's list was a tap, not a scan, so it is not counted. Shows nothing.
export function ScanCounter({ machineId, exerciseId }: { machineId?: string; exerciseId?: string }) {
  useEffect(() => {
    if (exerciseId) {
      try {
        if (document.referrer && new URL(document.referrer).pathname.startsWith("/scan/machine/")) return;
      } catch {
        // an unreadable referrer: count it
      }
    }
    fetch("/api/public/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(machineId ? { machineId } : { exerciseId }),
      keepalive: true,
    }).catch(() => {});
  }, [machineId, exerciseId]);
  return null;
}
