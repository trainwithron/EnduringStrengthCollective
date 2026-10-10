"use client";

import { useEffect, useMemo, useState } from "react";
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

// The SAME array every render until the groups change. The callers list it as an effect dependency (to read their data once the groups are known); a new array
// each render made those effects run again after every render, and each run set state, which rendered again: a loop that re-read the clients' workouts, the
// payments and the roster without stopping for as long as the page was open.
export function useOrgGroupIds(groupId: string): string[] | null {
  const groups = useOrgGroups(groupId);
  return useMemo(() => (groups ? groups.map((g) => g.id) : null), [groups]);
}
