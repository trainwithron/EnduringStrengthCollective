"use client";

import { startTransition, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ACTIVE_ORG_COOKIE_NAME, LAST_WORKSPACE_GROUP_COOKIE, decodeWorkspaceCookie } from "@/lib/workspace-header";
import { themeRefreshNeeded } from "@/lib/org-theme-refresh";

// The page's colors, fonts and icon are set once by the root layout from the remembered workspace (the last_workspace_group cookie). The coach area stays mounted while the coach moves between
// pages, so going into a group of ANOTHER organization (the workspace menu, a link, a card) never re-ran the root layout and the old organization's look stayed until a hard reload. The root layout stamps
// the workspace it used on <html data-workspace-group>; when the remembered workspace is now a different one, ask the server to render the layout again.
// The refresh waits until the page has finished starting up (Oct 26: a refresh asked for in the same moment the page was being brought to life, right after choosing an organization, is the likeliest
// cause of the one "Application error" on /programs, which came from the router itself) and is asked for at most once for the same pair of cookies, so it can never repeat.
export function OrgThemeSync() {
  const pathname = usePathname();
  const router = useRouter();
  const asked = useRef<string | null>(null);
  useEffect(() => {
    const read = (name: string) => decodeWorkspaceCookie(document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1]);
    const want = themeRefreshNeeded({
      remembered: read(LAST_WORKSPACE_GROUP_COOKIE),
      chosen: read(ACTIVE_ORG_COOKIE_NAME),
      usedGroup: document.documentElement.dataset.workspaceGroup ?? "",
      usedOrg: document.documentElement.dataset.activeOrg ?? "",
      alreadyAsked: asked.current,
    });
    if (!want) return;
    asked.current = want;
    // After this task, so the page is fully started; as a transition, so it never interrupts what is on screen.
    const timer = window.setTimeout(() => startTransition(() => router.refresh()), 0);
    return () => window.clearTimeout(timer);
  }, [pathname, router]);
  return null;
}
