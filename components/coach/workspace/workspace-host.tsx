"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useEmbedded } from "@/components/shared/embedded-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceDock } from "./workspace-dock";
import { WorkspaceFloating } from "./workspace-floating";
import { WorkspaceToolbar } from "./workspace-toolbar";
import { PanePicker } from "./pane-picker";
// Loaded here so the page's fetch is wrapped before any page creates a database client (see lib/workspace-mutation.ts).
import "@/lib/workspace-mutation";

// What the coach's shell tells the host about the page it is showing: which group the page is anchored on (and the coach it believes it is, to catch an account switch).
export interface ShellContext {
  coachId: string;
  groupId: string;
  groupName: string;
  isShared: boolean;
}

const RegisterCtx = createContext<((ctx: ShellContext | null) => void) | null>(null);

// Called by the coach shell: while a shell is on screen the workspace is shown. Does nothing where there is no host (a test, an embedded page).
export function useWorkspaceRegistration(): (ctx: ShellContext | null) => void {
  return useContext(RegisterCtx) ?? (() => {});
}

// The workspace host lives in the coach area's LAYOUT, above every page, so the workspace (its panes, their loaded pages and anything half-typed in them, the
// layout) is the same object while the main page navigates. WHO the coach is comes from the server layout (userId), so the host never depends on a page announcing
// it: a slow page load cannot tear the workspace down. Each page's shell only reports which group it is anchored on; the last report is kept, and when no coach
// page is on screen the workspace is hidden, never unmounted. In a framed page there is no host: a pane never contains another workspace.
export function WorkspaceHost({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const embedded = useEmbedded();
  const [ctx, setCtx] = useState<ShellContext | null>(null);
  const [shellOn, setShellOn] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback(
    (next: ShellContext | null) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (!next) {
        // Navigating between two pages unmounts one shell and mounts the next a moment later: hidden only if no shell comes back for a while. The context is kept.
        hideTimer.current = setTimeout(() => setShellOn(false), 1500);
        return;
      }
      // The page believes a different person is signed in than the one this layout was built for (another tab signed in as someone else): this layout is out of
      // date, and the previous person's workspace must not be shown to the new one. Start over with a full reload.
      if (userId && next.coachId !== userId) {
        window.location.reload();
        return;
      }
      setShellOn(true);
      setCtx((prev) => (prev && prev.coachId === next.coachId && prev.groupId === next.groupId && prev.groupName === next.groupName && prev.isShared === next.isShared ? prev : next));
    },
    [userId]
  );
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );

  if (embedded) return <>{children}</>;

  return (
    <RegisterCtx.Provider value={register}>
      {/* keyed by the person: a different person starts with a fresh workspace, never the previous one's. */}
      <WorkspaceProvider key={userId ?? "none"} coachId={userId && ctx ? userId : null} groupId={ctx?.groupId ?? ""} groupName={ctx?.groupName ?? ""} isShared={ctx?.isShared ?? false} suspended={!shellOn}>
        {children}
        <WorkspaceDock />
        <WorkspaceFloating />
        <WorkspaceToolbar />
        <PanePicker />
      </WorkspaceProvider>
    </RegisterCtx.Provider>
  );
}
