"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { isCoachType } from "@/lib/coach-type";
import type { CoachNavFacts } from "@/lib/team-coach";

// What the menus need to know about the signed-in coach: what they said they coach, whether they have a one-on-one client, and whether they own or administer an organization. Read once per person (the cache is
// keyed by who is signed in), a failed or not-yet-ready read is never kept, and the Settings change calls resetCoachNavFacts() so the menus follow it at once.
const CHANGED_EVENT = "coach-nav-facts-changed";
let cache: { userId: string; facts: CoachNavFacts } | null = null;

export function resetCoachNavFacts(): void {
  cache = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

export async function loadCoachNavFacts(): Promise<{ userId: string; facts: CoachNavFacts } | null> {
  try {
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    if (cache && cache.userId === user.id) return cache;
    const [{ data: profile, error: profileError }, { data: roles, error: rolesError }, { data: coached, error: coachedError }] = await Promise.all([
      supabase.from("profiles").select("coach_type").eq("id", user.id).maybeSingle(),
      supabase.from("organization_memberships").select("organization_id, role").eq("profile_id", user.id),
      supabase.from("group_memberships").select("group_id, groups ( group_kind )").eq("profile_id", user.id).eq("role", "coach"),
    ]);
    if (profileError || rolesError || coachedError) return null;
    const oneOnOneIds = ((coached ?? []) as unknown as { group_id: string; groups: { group_kind: string | null } | { group_kind: string | null }[] | null }[])
      .filter((r) => (Array.isArray(r.groups) ? r.groups[0]?.group_kind : r.groups?.group_kind) === "one_on_one")
      .map((r) => r.group_id);
    let hasOneOnOneClients = false;
    if (oneOnOneIds.length > 0) {
      // a client of their own: somebody other than the coach in one of their one-on-one spaces (their own personal space does not count)
      const { data: others, error: othersError } = await supabase.from("group_memberships").select("profile_id").in("group_id", oneOnOneIds.slice(0, 100)).eq("role", "athlete").neq("profile_id", user.id).limit(1);
      if (othersError) return null;
      hasOneOnOneClients = (others ?? []).length > 0 || oneOnOneIds.length > 100;
    }
    // An organization they own or administer counts only when it is run with other people: every self-signup coach owns a solo organization, which is not "running a gym".
    const runIds = ((roles ?? []) as { organization_id: string; role: string }[]).filter((r) => r.role === "owner" || r.role === "admin").map((r) => r.organization_id);
    let runsOrgWithOthers = false;
    if (runIds.length > 0) {
      const { data: others, error: othersError } = await supabase.from("organization_memberships").select("profile_id").in("organization_id", runIds.slice(0, 100)).neq("profile_id", user.id).limit(1);
      if (othersError) return null;
      runsOrgWithOthers = (others ?? []).length > 0 || runIds.length > 100;
    }
    const value = (profile as { coach_type?: string | null } | null)?.coach_type;
    const facts: CoachNavFacts = {
      coachType: isCoachType(value) ? value : null,
      hasOneOnOneClients,
      runsOrgWithOthers,
    };
    cache = { userId: user.id, facts };
    return cache;
  } catch {
    return null;
  }
}

export function useCoachNavFacts(): CoachNavFacts | null {
  const [facts, setFacts] = useState<CoachNavFacts | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    window.addEventListener(CHANGED_EVENT, again);
    return () => window.removeEventListener(CHANGED_EVENT, again);
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadCoachNavFacts().then((result) => {
      if (!cancelled) setFacts(result?.facts ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return facts;
}
