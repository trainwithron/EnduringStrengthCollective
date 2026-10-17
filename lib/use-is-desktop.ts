"use client";

import { useSyncExternalStore } from "react";

// True from the lg breakpoint (1024px) up. A phone (and the server render) is false, so something that has a phone place and a desktop place can mount in just ONE of them.
const QUERY = "(min-width: 1024px)";
function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
