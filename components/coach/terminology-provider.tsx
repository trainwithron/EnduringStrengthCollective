"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { TermForm, TermKey, TermOverride, TerminologyOverrides } from "@/lib/terminology";
import { termText } from "@/lib/term-text";
import { isTeamSportGroup, orgIsTeamOnly, teamWordsFromHint, withTeamSportWords } from "@/lib/team-sport";
import { useTeamWordsHint } from "@/components/coach/team-words-hint";

interface TerminologyContextValue {
  overrides: TerminologyOverrides;
  setOverride: (key: TermKey, override: TermOverride | null) => void;
  // True inside a TerminologyProvider; lets a control (the chooser) reuse the page's own vocabulary when there is one.
  mounted: boolean;
  // The page's group is a team-sport group (its words default to "athletes").
  teamSport: boolean;
}

const TerminologyContext = createContext<TerminologyContextValue>({
  overrides: {},
  setOverride: () => {},
  mounted: false,
  teamSport: false,
});

// One coach-wide (per-org) vocabulary preference, fetched once and held
// in context so every SwappableTerm on the page reads/writes the same
// live state instead of each re-fetching independently. Wraps
// CoachDesktopShell and CoachHomeShell — the two shells every coach page
// renders inside.
export function TerminologyProvider({
  children,
  groupId,
}: {
  children: React.ReactNode;
  // Anchors which organization's vocabulary to load. A coach who
  // owns/admins more than one organization has more than one row in
  // organization_memberships, so a blind profile_id-only lookup would
  // resolve to an arbitrary other org's wording instead of the one for
  // the group actually being viewed. Omit only where there's genuinely
  // no current group yet (e.g. a brand-new coach's first Home visit).
  groupId?: string;
}) {
  const [saved, setOverrides] = useState<TerminologyOverrides>({});
  // The server drew the first frame knowing whether this workspace is a team (root layout hint), so a team coach reads "Athletes" from the very first frame, with no "Clients" flash. The browser-side read
  // below still decides afterwards and corrects it if it changed.
  const hint = useTeamWordsHint();
  const [teamSport, setTeamSport] = useState(() => teamWordsFromHint(hint, groupId));

  // The page is first drawn by the server, which does not know the group is a team: a team coach would see "Clients" until the read below finishes. So the last answer for this group is remembered in this browser
  // and applied the moment the page is up (the read below still decides, and corrects it if it changed).
  useEffect(() => {
    if (!groupId) return;
    try {
      if (window.localStorage.getItem(`team-sport-words:${groupId}`) === "1") setTeamSport(true);
    } catch {
      // storage unavailable: the read below still sets it
    }
  }, [groupId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      let organizationId: string | null = null;
      if (groupId) {
        const { data: group } = await supabase
          .from("groups")
          .select("organization_id, team_mode")
          .eq("id", groupId)
          .maybeSingle();
        organizationId = group?.organization_id ?? null;
        // A team-sport group, or a group in an organization whose groups are ALL team-sport groups, says "athletes".
        let isTeam = isTeamSportGroup((group as { team_mode?: boolean | null } | null)?.team_mode);
        if (!isTeam && organizationId) {
          const { data: orgGroups, error: orgGroupsError } = await supabase.from("groups").select("team_mode").eq("organization_id", organizationId).limit(500);
          isTeam = !orgGroupsError && orgIsTeamOnly((orgGroups ?? []) as { team_mode?: boolean | null }[]);
        }
        if (!cancelled) setTeamSport(isTeam);
        try {
          if (isTeam) window.localStorage.setItem(`team-sport-words:${groupId}`, "1");
          else window.localStorage.removeItem(`team-sport-words:${groupId}`);
        } catch {
          // storage unavailable: nothing is remembered
        }
      }

      const { data: membership } = organizationId
        ? await supabase
            .from("organization_memberships")
            .select("organization_id")
            .eq("organization_id", organizationId)
            .eq("profile_id", user.id)
            .maybeSingle()
        : await supabase
            .from("organization_memberships")
            .select("organization_id")
            .eq("profile_id", user.id)
            .limit(1)
            .maybeSingle();
      if (!membership) return;
      const { data: org } = await supabase
        .from("organizations")
        .select("terminology_overrides")
        .eq("id", membership.organization_id)
        .maybeSingle();
      if (!cancelled && org?.terminology_overrides) {
        setOverrides(org.terminology_overrides as TerminologyOverrides);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  function setOverride(key: TermKey, override: TermOverride | null) {
    // Optimistic — every SwappableTerm on the page updates immediately;
    // a failed persist just means it won't survive a reload, not a
    // broken interaction.
    setOverrides((prev) => {
      const next = { ...prev };
      if (override) next[key] = override;
      else delete next[key];
      return next;
    });
    fetch("/api/organizations/terminology", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, override, groupId }),
    }).catch(() => {});
  }

  // A team-sport group reads "athletes" unless the coach picked their own word.
  const overrides = withTeamSportWords(saved, teamSport);
  return <TerminologyContext.Provider value={{ overrides, setOverride, mounted: true, teamSport }}>{children}</TerminologyContext.Provider>;
}

export function useTerminology() {
  return useContext(TerminologyContext);
}

// The coach's own word as a string, for a place that builds text (a button, a placeholder, an empty state): useTerm()("client", "plural", { cap: true }) is
// "Clients" or "Athletes" or whatever they chose; without cap it is lowercase, for the middle of a sentence.
export function useTerm() {
  const { overrides } = useTerminology();
  return (key: TermKey, form: TermForm = "singular", opts: { cap?: boolean } = {}) => termText(overrides, key, form, opts);
}
