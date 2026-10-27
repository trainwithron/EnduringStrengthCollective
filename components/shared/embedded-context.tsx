"use client";

import { createContext, useContext, useEffect, useState } from "react";

// True when this page is being shown INSIDE another page of the app (a workspace pane): the server says so from the browser's own Sec-Fetch-Dest: iframe header
// (lib/embedded-request.ts), and the browser is asked again on arrival in case that header was missing. An embedded page drops the site's own chrome (rail,
// panels, top bar) and shows only its content, so a pane never contains a second copy of the whole app around it.
const EmbeddedContext = createContext(false);

export function EmbeddedProvider({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  return <EmbeddedContext.Provider value={embedded}>{children}</EmbeddedContext.Provider>;
}

// Once this page (in the browser) is known to be in a pane, it stays so. A refresh asks the server again, and that request carries no iframe label, so a page opened after it
// would draw the whole app first and swap it for its content a moment later: everything on the page was mounted twice (Oct 26: New program made two programs 5 ms apart).
// Only ever set in the browser: on the server this module is shared by every request.
let framedHere = false;

function inFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin parent throws: it is framed.
    return true;
  }
}

export function useEmbedded(): boolean {
  const fromServer = useContext(EmbeddedContext);
  if (fromServer && typeof window !== "undefined") framedHere = true;
  const [fromBrowser, setFromBrowser] = useState(() => typeof window !== "undefined" && framedHere);
  useEffect(() => {
    const framed = inFrame();
    if (framed) framedHere = true;
    setFromBrowser(framed);
  }, []);
  return fromServer || fromBrowser;
}
