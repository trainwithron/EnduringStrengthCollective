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

// What the coach's shell tells the host about the page it is showing (who the coach is, which group the page is anchored on).
export interface ShellContext {
  coachId: string;
  groupId: string;
  groupName: string;
  isShared: boolean;
}

const RegisterCtx = createContext<((ctx: ShellContext | null) => void) | null>(null);

// Called by the coach shell: while a shell is on screen the workspace is available. Does nothing where there is no host (a test, an embedded page).
export function useWorkspaceRegistration(): (ctx: ShellContext | null) => void {
  return useContext(RegisterCtx) ?? (() => {});
}

// The workspace host lives in the coach area's LAYOUT, above every page, so the workspace (its panes, their loaded pages and anything half-typed in them, the layout)
// is the same object while the main page navigates. Each page's shell only reports who and where it is. In a framed page there is no host: a pane never contains
// another workspace.
export function WorkspaceHost({ children }: { children: React.ReactNode }) {
  const embedded = useEmbedded();
  const [ctx, setCtx] = useState<ShellContext | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigating between two pages unmounts one shell and mounts the next a moment later: the workspace stays up across that gap, and only goes when a page
  // with no shell (an athlete page, say) stays on screen.
  const register = useCallback((next: ShellContext | null) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (next) setCtx((prev) => (prev && prev.coachId === next.coachId && prev.groupId === next.groupId && prev.groupName === next.groupName && prev.isShared === next.isShared ? prev : next));
    else hideTimer.current = setTimeout(() => setCtx(null), 1200);
  }, []);
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );

  if (embedded) return <>{children}</>;

  return (
    <RegisterCtx.Provider value={register}>
      <WorkspaceProvider coachId={ctx?.coachId ?? null} groupId={ctx?.groupId ?? ""} groupName={ctx?.groupName ?? ""} isShared={ctx?.isShared ?? false}>
        {children}
        <WorkspaceDock />
        <WorkspaceFloating />
        <WorkspaceToolbar />
        <PanePicker />
      </WorkspaceProvider>
    </RegisterCtx.Provider>
  );
}
