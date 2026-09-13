"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { TermForm, TermKey, TermOverride, TerminologyOverrides } from "@/lib/terminology";

interface TerminologyContextValue {
  overrides: TerminologyOverrides;
  setOverride: (key: TermKey, override: TermOverride | null) => void;
}

const TerminologyContext = createContext<TerminologyContextValue>({
  overrides: {},
  setOverride: () => {},
});

// One coach-wide (per-org) vocabulary preference, fetched once and held
// in context so every SwappableTerm on the page reads/writes the same
// live state instead of each re-fetching independently. Wraps
// CoachDesktopShell and CoachHomeShell — the two shells every coach page
// renders inside.
export function TerminologyProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<TerminologyOverrides>({});

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("organization_id")
        .eq("profile_id", user.id)
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
  }, []);

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
      body: JSON.stringify({ key, override }),
    }).catch(() => {});
  }

  return <TerminologyContext.Provider value={{ overrides, setOverride }}>{children}</TerminologyContext.Provider>;
}

export function useTerminology() {
  return useContext(TerminologyContext);
}
