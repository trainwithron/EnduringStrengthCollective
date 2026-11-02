"use client";

import { useEffect, useRef } from "react";
import { SCAN_RESET_MS, isScannerBurst, normalizeCardCode } from "@/lib/checkin-cards";

// A barcode scanner plugged into (or paired with) the tablet "types" a card number fast and presses Enter. This listens for that anywhere on the page, even while a search
// box has the focus, and hands over the number; a person typing is left alone. The caller clears whatever the scan typed into a box.
export function useCardScanner(onScan: (code: string) => void, enabled = true) {
  const handler = useRef(onScan);
  handler.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    let chars = "";
    let times: number[] = [];
    const down = (e: KeyboardEvent) => {
      const now = Date.now();
      if (times.length > 0 && now - times[times.length - 1] > SCAN_RESET_MS) {
        chars = "";
        times = [];
      }
      if (e.key === "Enter") {
        const code = normalizeCardCode(chars);
        const burst = isScannerBurst(times);
        chars = "";
        times = [];
        if (code && burst) {
          e.preventDefault();
          e.stopPropagation();
          handler.current(code);
        }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        chars += e.key;
        times.push(now);
      }
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [enabled]);
}
