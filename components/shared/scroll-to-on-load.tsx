"use client";

import { useEffect } from "react";

// Brings one element into view when the page opens (a program list opening on the week they are up to, not week 1).
export function ScrollToOnLoad({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.scrollIntoView({ block: "start" });
  }, [targetId]);
  return null;
}
