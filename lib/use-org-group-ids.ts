"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { getCoachedGroups, groupsInOrgOf, type CoachedGroup } from "@/lib/coach-groups";

// Client-side twin of the server's org scoping: the coached groups in the
// SAME organization as `groupId`, so rail widgets and list-panel pieces can
// show the coach's whole org instead of whichever single group (often one
// client's own group) happens to be in the URL. One cached lookup per
// (page group), shared by every component that asks.
const cache = new Map<string, Promise<CoachedGroup[]>>();

export function loadOrgGroups(groupId: string): Promise<CoachedGroup[]> {
  let p = cache.get(groupId);
  if (!p) {
    p = (async () => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const all = await getCoachedGroups(supabase, user.id);
      return groupsInOrgOf(all, groupId);
    })().catch(() => {
      cache.delete(groupId);
      return [];
    });
    cache.set(groupId, p);
  }
  return p;
}

// Forget what was looked up. Called when the coach's groups change in this page (a new one-on-one client gets a new group of their own), so the lists built from them read the groups again.
export function forgetOrgGroups(): void {
  cache.clear();
}

// null while loading; [] only if the coach doesn't coach this group.
export function useOrgGroups(groupId: string): CoachedGroup[] | null {
  const [groups, setGroups] = useState<CoachedGroup[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadOrgGroups(groupId).then((g) => {
      if (!cancelled) setGroups(g);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);
  return groups;
}

export function useOrgGroupIds(groupId: string): string[] | null {
  const groups = useOrgGroups(groupId);
  return groups ? groups.map((g) => g.id) : null;
}
