"use client";

import { createContext, useContext, useEffect, useState } from "react";

// True when this page is being shown INSIDE another page of the app (a workspace pane): the server says so from the browser's own Sec-Fetch-Dest: iframe header
// (lib/embedded-request.ts), and the browser is asked again on arrival in case that header was missing. An embedded page drops the site's own chrome (rail,
// panels, top bar) and shows only its content, so a pane never contains a second copy of the whole app around it.
const EmbeddedContext = createContext(false);

export function EmbeddedProvider({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  return <EmbeddedContext.Provider value={embedded}>{children}</EmbeddedContext.Provider>;
}

export function useEmbedded(): boolean {
  const fromServer = useContext(EmbeddedContext);
  const [fromBrowser, setFromBrowser] = useState(false);
  useEffect(() => {
    try {
      setFromBrowser(window.self !== window.top);
    } catch {
      // A cross-origin parent throws: it is framed.
      setFromBrowser(true);
    }
  }, []);
  return fromServer || fromBrowser;
}
