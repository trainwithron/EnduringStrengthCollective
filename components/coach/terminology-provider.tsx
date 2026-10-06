"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { TermForm, TermKey, TermOverride, TerminologyOverrides } from "@/lib/terminology";
import { termText } from "@/lib/term-text";

interface TerminologyContextValue {
  overrides: TerminologyOverrides;
  setOverride: (key: TermKey, override: TermOverride | null) => void;
  // True inside a TerminologyProvider; lets a control (the chooser) reuse the page's own vocabulary when there is one.
  mounted: boolean;
}

const TerminologyContext = createContext<TerminologyContextValue>({
  overrides: {},
  setOverride: () => {},
  mounted: false,
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
  const [overrides, setOverrides] = useState<TerminologyOverrides>({});

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
          .select("organization_id")
          .eq("id", groupId)
          .maybeSingle();
        organizationId = group?.organization_id ?? null;
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

  return <TerminologyContext.Provider value={{ overrides, setOverride, mounted: true }}>{children}</TerminologyContext.Provider>;
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
