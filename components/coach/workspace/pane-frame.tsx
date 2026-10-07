"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { PaneState } from "@/lib/workspace-layout";
import { isAllowedWorkspacePath } from "@/lib/workspace-destinations";
import { useWorkspace } from "./workspace-context";

// One pane's content: the destination's page, loaded in a frame of its own. The page draws only its content there (see components/shared/embedded-context.tsx),
// keeps its own state while the pane is hidden behind another tab, and its links stay inside the pane. Only the app's own pages are ever loaded.
export function PaneFrame({ pane, hidden }: { pane: PaneState; hidden?: boolean }) {
  const ws = useWorkspace();
  const ref = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const allowed = isAllowedWorkspacePath(pane.dest.path);

  useEffect(() => {
    const el = ref.current;
    if (!ws || !el) return;
    ws.registerFrame(pane.id, el);
    return () => ws.registerFrame(pane.id, null);
    // registerFrame is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id]);

  if (!allowed) {
    return <p className="p-4 font-body text-sm text-steel">This page cannot be shown here.</p>;
  }

  return (
    <div className={`relative flex-1 min-h-0 ${hidden ? "hidden" : ""}`}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center font-body text-xs text-steel" aria-live="polite">
          <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" aria-hidden="true" />
          Loading {pane.dest.label}…
        </div>
      )}
      <iframe
        ref={ref}
        src={pane.dest.path}
        title={pane.dest.label}
        onLoad={() => setLoaded(true)}
        // Same site only (see security-headers.mjs). Scripts, forms and the camera are needed; the sandbox has no top-navigation permission, so a pane can never take over the main window.
        sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"
        allow="camera; microphone; clipboard-write"
        className="absolute inset-0 w-full h-full border-0 bg-graphite"
      />
    </div>
  );
}
