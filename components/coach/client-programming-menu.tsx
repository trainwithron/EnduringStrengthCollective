"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { duplicateProgram } from "@/lib/program-duplication";
import { ChevronDown } from "lucide-react";

const MENU_WIDTH = 256;

interface SharedProgramOption {
  id: string;
  name: string;
}
interface AssignedProgramOption {
  id: string;
  name: string;
  isActive: boolean;
}

type View = "menu" | "assign" | "assigned";

// The client-profile counterpart to program-card-menu.tsx's "Assign to
// Client" — same duplicateProgram engine, same portal-dropdown shell,
// just started from a known client instead of a known program. Closes
// the one real gap left on this page: assigning or reviewing a client's
// programs used to require leaving their profile to find the program in
// the Programs list first.
export function ClientProgrammingMenu({
  groupId,
  athleteId,
  athleteFullName,
}: {
  groupId: string;
  athleteId: string;
  athleteFullName: string;
}) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [sharedPrograms, setSharedPrograms] = useState<SharedProgramOption[] | null>(null);
  const [assignedPrograms, setAssignedPrograms] = useState<AssignedProgramOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({ top: rect.bottom + 4, left: rect.right - MENU_WIDTH });
    }
    setView("menu");
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setView(null);
    }
    function handleScroll() {
      setView(null);
    }
    if (view) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [view]);

  async function loadSharedPrograms() {
    if (sharedPrograms) return;
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("programs")
      .select("id, name")
      .eq("group_id", groupId)
      .is("athlete_id", null)
      .order("name");
    setSharedPrograms(data ?? []);
  }

  async function loadAssignedPrograms() {
    if (assignedPrograms) return;
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("programs")
      .select("id, name, is_active")
      .eq("group_id", groupId)
      .eq("athlete_id", athleteId)
      .order("created_at", { ascending: false });
    setAssignedPrograms((data ?? []).map((p) => ({ id: p.id, name: p.name, isActive: p.is_active })));
  }

  async function handleAssign(program: SharedProgramOption) {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }

    const result = await duplicateProgram(supabase, {
      sourceProgramId: program.id,
      destinationGroupId: groupId,
      createdBy: user.id,
      athleteId,
      clientName: athleteFullName,
    });

    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push(`/groups/${groupId}/programs/${result.programId}`);
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (view ? setView(null) : openMenu())}
        className="inline-flex items-center gap-1.5 h-9 font-body text-xs text-rust border border-rust px-3"
      >
        Programming
        <ChevronDown className={`w-3 h-3 transition-transform ${view ? "rotate-180" : ""}`} />
      </button>

      {view && position && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: position.top, left: position.left, width: MENU_WIDTH }}
          className="bg-surface border border-steel/30 z-50 shadow-lg"
        >
          {error && (
            <p className="font-body text-[11px] text-rust px-3 pt-2.5" role="alert">
              {error}
            </p>
          )}

          {view === "menu" && (
            <div>
              <button
                type="button"
                onClick={() => {
                  setView("assign");
                  loadSharedPrograms();
                }}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
              >
                Assign Program
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("assigned");
                  loadAssignedPrograms();
                }}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
              >
                View Assigned Programs
              </button>
            </div>
          )}

          {view === "assign" && (
            <div>
              <p className="font-body text-[11px] text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">
                Assign which program?
              </p>
              <div className="max-h-72 overflow-y-auto">
                {sharedPrograms === null && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">Loading…</p>
                )}
                {sharedPrograms?.length === 0 && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">
                    No shared programs in this group yet.
                  </p>
                )}
                {sharedPrograms?.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAssign(p)}
                    className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50 disabled:opacity-40"
                  >
                    {busy ? "Assigning…" : p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {view === "assigned" && (
            <div>
              <p className="font-body text-[11px] text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">
                {athleteFullName}&apos;s programs
              </p>
              <div className="max-h-72 overflow-y-auto">
                {assignedPrograms === null && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">Loading…</p>
                )}
                {assignedPrograms?.length === 0 && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">
                    No programs assigned to this client yet.
                  </p>
                )}
                {assignedPrograms?.map((p) => (
                  <a
                    key={p.id}
                    href={`/groups/${groupId}/programs/${p.id}`}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
                  >
                    <span className="truncate">{p.name}</span>
                    <span
                      className={`shrink-0 font-body text-[10px] uppercase tracking-wide ${
                        p.isActive ? "text-moss" : "text-steel"
                      }`}
                    >
                      {p.isActive ? "Active" : "Inactive"}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
