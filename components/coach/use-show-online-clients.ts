"use client";

import { useEffect, useState } from "react";
import { readShowOnline, writeShowOnline } from "@/lib/client-type";

// The "Show online clients" switch, remembered in this browser. Hidden on the first render (the server and the browser agree), then the saved choice is read once the page is on screen.
export function useShowOnlineClients(): [boolean, (show: boolean) => void] {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(readShowOnline(typeof window === "undefined" ? null : window.localStorage));
  }, []);
  return [
    show,
    (next: boolean) => {
      setShow(next);
      writeShowOnline(typeof window === "undefined" ? null : window.localStorage, next);
    },
  ];
}
