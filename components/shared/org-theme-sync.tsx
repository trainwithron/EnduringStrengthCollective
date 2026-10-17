"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LAST_WORKSPACE_GROUP_COOKIE, decodeWorkspaceCookie } from "@/lib/workspace-header";

// The page's colors, fonts and icon are set once by the root layout from the remembered workspace (the last_workspace_group cookie). The coach area stays mounted while the coach moves between
// pages, so going into a group of ANOTHER organization (the workspace menu, a link, a card) never re-ran the root layout and the old organization's look stayed until a hard reload. The root layout stamps
// the workspace it used on <html data-workspace-group>; when the remembered workspace is now a different one, ask the server to render the layout again.
export function OrgThemeSync() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${LAST_WORKSPACE_GROUP_COOKIE}=`))?.split("=")[1];
    const remembered = decodeWorkspaceCookie(raw);
    const used = document.documentElement.dataset.workspaceGroup ?? "";
    if (remembered && remembered !== used) router.refresh();
  }, [pathname, router]);
  return null;
}
