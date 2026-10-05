"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { LAST_WORKSPACE_GROUP_COOKIE } from "@/lib/coach-groups";

export interface SwitchableOrg {
  id: string;
  name: string;
  // The group to anchor coach-wide pages on once this org is chosen.
  anchorGroupId: string;
}

export interface AdministeredOrg {
  id: string;
  name: string;
  // A group in that org, used only to open its admin pages.
  groupId: string;
}

// The organization name in the top bar. Organizations are separate
// businesses, so this is a plain label for a coach in one org, and a
// switcher ONLY for a coach who coaches in 2+ orgs. Orgs they merely own
// or administer (without coaching) are listed separately as admin-only
// entries that open that org's admin pages — never its clients or
// programming.
export function OrgSwitcher({
  currentOrgName,
  orgs,
  currentOrgId,
  administered,
}: {
  currentOrgName: string;
  orgs: SwitchableOrg[];
  currentOrgId: string | null;
  administered: AdministeredOrg[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const hasChoices = orgs.length >= 2 || administered.length > 0;

  const label = (
    <span className="hidden sm:inline font-body text-xs md:text-sm text-steel truncate max-w-[10rem] md:max-w-[16rem]" title={currentOrgName}>
      {currentOrgName}
    </span>
  );

  if (!hasChoices) return label;

  function chooseOrg(org: SwitchableOrg) {
    try {
      document.cookie = `${LAST_WORKSPACE_GROUP_COOKIE}=${encodeURIComponent(org.anchorGroupId)}; path=/; max-age=${60 * 60 * 24 * 90}`;
    } catch {
      // Non-fatal: Home falls back to that org's first group.
    }
    setOpen(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div ref={wrapRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 font-body text-xs md:text-sm text-steel hover:text-chalk"
      >
        {label}
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 z-50 min-w-[14rem] bg-graphite border border-steel/30 shadow-xl py-1">
          {orgs.length >= 2 && (
            <>
              <p className="px-3 pt-1 pb-0.5 font-body text-xs text-steel uppercase tracking-wide">Your organizations</p>
              {orgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="menuitem"
                  onClick={() => chooseOrg(o)}
                  className={`block w-full text-left px-3 py-2 font-body text-sm ${
                    o.id === currentOrgId ? "text-rust bg-rust/10" : "text-chalk hover:bg-surface/60"
                  }`}
                >
                  {o.name}
                </button>
              ))}
            </>
          )}
          {administered.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-0.5 font-body text-xs text-steel uppercase tracking-wide">Admin only</p>
              {administered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/groups/${o.groupId}/branding`);
                  }}
                  className="block w-full text-left px-3 py-2 font-body text-sm text-chalk hover:bg-surface/60"
                >
                  {o.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
