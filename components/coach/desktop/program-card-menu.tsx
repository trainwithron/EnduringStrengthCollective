"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { duplicateProgram } from "@/lib/program-duplication";
import { notifyPush } from "@/lib/push-notify";
import { MoreVertical } from "lucide-react";

const MENU_WIDTH = 256; // matches w-64 below

interface ClientOption {
  id: string;
  fullName: string;
}
interface OrgOption {
  id: string;
  name: string;
}
interface GroupOption {
  id: string;
  name: string;
}
interface PositionOption {
  id: string;
  name: string;
  athleteCount: number;
}
interface BulkAssignResult {
  succeeded: number;
  total: number;
  failedNames: string[];
  positionName: string;
}

type View =
  | "menu"
  | "assign"
  | "assign-self"
  | "assign-position"
  | "assign-position-result"
  | "duplicate-org"
  | "duplicate-group";

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ProgramCardMenu({
  programId,
  programName,
  groupId,
}: {
  programId: string;
  programName: string;
  groupId: string;
}) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [orgs, setOrgs] = useState<OrgOption[] | null>(null);
  const [orgGroups, setOrgGroups] = useState<GroupOption[] | null>(null);
  const [positions, setPositions] = useState<PositionOption[] | null>(null);
  const [assignProgress, setAssignProgress] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkAssignResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignStartDate, setAssignStartDate] = useState(todayDateString());

  // Rendered through a portal (see the return below) instead of a plain
  // absolutely-positioned child — every program card wraps its content in
  // overflow-hidden (to crop the cover image cleanly), which was clipping
  // this dropdown to whatever sliver of the card remained below the
  // trigger button, worse on smaller card sizes. A portal to <body>,
  // positioned from the trigger's real screen coordinates, escapes that
  // ancestor entirely.
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
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setView(null);
    }
    // Closes on scroll rather than re-tracking position continuously —
    // simple and matches how most dropdown menus behave when the page
    // moves under them.
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

  async function loadClients() {
    if (clients) return;
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("group_memberships")
      .select("profile_id, profiles ( id, full_name )")
      .eq("group_id", groupId)
      .eq("role", "athlete");
    const options = (data ?? [])
      .map((row: any) => ({ id: row.profiles?.id, fullName: row.profiles?.full_name }))
      .filter((c): c is ClientOption => !!c.id)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    setClients(options);
  }

  // Only orgs this coach owns/admins — the same permission level
  // components/coach/desktop/group-switcher.tsx already checks for
  // switching between groups. Duplicating into a group you merely coach
  // (not own/admin) isn't offered here.
  async function loadOrgs() {
    if (orgs) return;
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("organization_memberships")
      .select("organization_id, role, organizations ( id, name )")
      .eq("profile_id", user.id)
      .in("role", ["owner", "admin"]);
    const options = (data ?? [])
      .map((row: any) => ({ id: row.organizations?.id, name: row.organizations?.name }))
      .filter((o): o is OrgOption => !!o.id);
    setOrgs(options);
  }

  async function loadGroupsForOrg(orgId: string) {
    setOrgGroups(null);
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("groups")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("name");
    setOrgGroups(data ?? []);
    setView("duplicate-group");
  }

  // Same "load positions with real players, ignore empty ones" shape
  // already used by the position-aware leaderboard and Team Depth Chart —
  // this menu doesn't pre-check whether any exist before showing the
  // button (same as "Duplicate to another organization →" below), it
  // just shows an empty state once loaded.
  async function loadPositions() {
    if (positions) return;
    const supabase = createBrowserClient();
    const [{ data: posRows }, { data: memberRows }] = await Promise.all([
      supabase.from("group_positions").select("id, name, sort_order").eq("group_id", groupId).order("sort_order"),
      supabase
        .from("group_memberships")
        .select("position_id")
        .eq("group_id", groupId)
        .eq("role", "athlete")
        .not("position_id", "is", null),
    ]);
    const countByPosition = new Map<string, number>();
    for (const m of memberRows ?? []) {
      countByPosition.set(m.position_id, (countByPosition.get(m.position_id) ?? 0) + 1);
    }
    const options = (posRows ?? [])
      .map((p) => ({ id: p.id, name: p.name, athleteCount: countByPosition.get(p.id) ?? 0 }))
      .filter((p) => p.athleteCount > 0);
    setPositions(options);
  }

  async function handleAssignToPosition(position: PositionOption) {
    const supabase = createBrowserClient();
    const { data: memberRows } = await supabase
      .from("group_memberships")
      .select("profile_id, profiles ( full_name )")
      .eq("group_id", groupId)
      .eq("position_id", position.id)
      .eq("role", "athlete");
    const athletes = (memberRows ?? [])
      .map((row: any) => ({ id: row.profile_id, fullName: row.profiles?.full_name ?? "Unknown" }))
      .filter((a) => !!a.id);
    if (athletes.length === 0) return;

    if (
      !window.confirm(
        `Assign "${programName}" to all ${athletes.length} athletes on ${position.name}?\n\n${athletes
          .map((a) => a.fullName)
          .join(", ")}`
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }

    let succeeded = 0;
    const failedNames: string[] = [];
    for (let i = 0; i < athletes.length; i++) {
      const athlete = athletes[i];
      setAssignProgress(`Assigning ${i + 1} of ${athletes.length}…`);
      const result = await duplicateProgram(supabase, {
        sourceProgramId: programId,
        destinationGroupId: groupId,
        createdBy: user.id,
        athleteId: athlete.id,
        clientName: athlete.fullName,
        startDate: assignStartDate || undefined,
      });
      if ("error" in result) {
        failedNames.push(athlete.fullName);
      } else {
        succeeded++;
        notifyPush(
          athlete.id,
          "New program",
          `Your coach assigned you a new program: ${programName} — ${athlete.fullName}`,
          `/groups/${groupId}/programs/${result.programId}`
        );
      }
    }

    setBusy(false);
    setAssignProgress(null);
    setBulkResult({ succeeded, total: athletes.length, failedNames, positionName: position.name });
    setView("assign-position-result");
  }

  async function handleAssignToClient(client: ClientOption) {
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
      sourceProgramId: programId,
      destinationGroupId: groupId,
      createdBy: user.id,
      athleteId: client.id,
      clientName: client.fullName,
      startDate: assignStartDate || undefined,
    });

    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // Mirrors notify_on_program_assigned (migration 0071) — the DB
    // trigger already writes the in-app notification row for this same
    // insert; a trigger can't also fire the push itself, so this fires
    // it right after the duplication it already knows succeeded. Uses
    // the same suffixed name (lib/program-duplication.ts) the trigger
    // itself reads off the new row, not the source program's plain name.
    notifyPush(
      client.id,
      "New program",
      `Your coach assigned you a new program: ${programName} — ${client.fullName}`,
      `/groups/${groupId}/programs/${result.programId}`
    );
    router.push(`/groups/${groupId}/programs/${result.programId}`);
  }

  async function handleAssignToSelf() {
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
      sourceProgramId: programId,
      destinationGroupId: groupId,
      createdBy: user.id,
      athleteId: user.id,
      startDate: assignStartDate || undefined,
    });

    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push(`/groups/${groupId}/programs/${result.programId}`);
  }

  async function handleDuplicateSameGroup() {
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
      sourceProgramId: programId,
      destinationGroupId: groupId,
      createdBy: user.id,
    });

    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push(`/groups/${groupId}/programs/${result.programId}`);
  }

  async function handleDuplicateToGroup(destinationGroupId: string) {
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

    // If the coach isn't already staffing the destination group, self-
    // provision a coach membership first — same pattern
    // GroupSwitcher.switchTo() already uses, needed because
    // programs_write_coach requires is_group_coach(destination) to
    // insert the duplicated rows there at all.
    const { data: existing } = await supabase
      .from("group_memberships")
      .select("group_id")
      .eq("group_id", destinationGroupId)
      .eq("profile_id", user.id)
      .maybeSingle();

    if (!existing) {
      const { error: insertError } = await supabase
        .from("group_memberships")
        .insert({ group_id: destinationGroupId, profile_id: user.id, role: "coach" });
      if (insertError) {
        setBusy(false);
        setError("Couldn't get access to that group — try again.");
        return;
      }
    }

    const result = await duplicateProgram(supabase, {
      sourceProgramId: programId,
      destinationGroupId,
      createdBy: user.id,
    });

    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push(`/groups/${destinationGroupId}/programs/${result.programId}`);
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${programName}"? Any real logged history stays intact.`)) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase.from("programs").delete().eq("id", programId);
    setBusy(false);
    if (deleteError) {
      setError("Couldn't delete — it may still have logged sessions tied to it.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (view ? setView(null) : openMenu())}
        aria-label="Program options"
        className="w-7 h-7 flex items-center justify-center text-steel active:text-rust transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
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
                  setAssignStartDate(todayDateString());
                  setView("assign");
                  loadClients();
                }}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
              >
                Assign to Client
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssignStartDate(todayDateString());
                  setView("assign-position");
                  loadPositions();
                }}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
              >
                Assign to Position →
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssignStartDate(todayDateString());
                  setView("assign-self");
                }}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
              >
                Assign to Myself
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDuplicateSameGroup}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50 disabled:opacity-40"
              >
                {busy ? "Duplicating…" : "Duplicate"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("duplicate-org");
                  loadOrgs();
                }}
                className="w-full text-left px-3 py-2.5 font-body text-xs text-steel hover:bg-graphite/50"
              >
                Duplicate to another organization →
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDelete}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-rust hover:bg-graphite/50 disabled:opacity-40 border-t border-steel/15"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          )}

          {view === "assign" && (
            <div>
              <p className="font-body text-[11px] text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">
                Assign to which client?
              </p>
              <div className="px-3 pb-2">
                <label className="font-body text-[11px] text-steel">
                  Start date
                  <input
                    type="date"
                    value={assignStartDate}
                    onChange={(e) => setAssignStartDate(e.target.value)}
                    className="w-full h-8 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
                  />
                </label>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {clients === null && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">Loading…</p>
                )}
                {clients?.length === 0 && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">No clients in this group yet.</p>
                )}
                {clients?.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAssignToClient(c)}
                    className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50 disabled:opacity-40"
                  >
                    {busy ? "Assigning…" : c.fullName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {view === "assign-self" && (
            <div className="p-3">
              <p className="font-body text-[11px] text-steel uppercase tracking-wide pb-1.5">
                Assign to yourself
              </p>
              <label className="font-body text-[11px] text-steel">
                Start date
                <input
                  type="date"
                  value={assignStartDate}
                  onChange={(e) => setAssignStartDate(e.target.value)}
                  className="w-full h-8 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={handleAssignToSelf}
                className="w-full h-8 mt-2.5 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
              >
                {busy ? "Assigning…" : "Assign & open"}
              </button>
            </div>
          )}

          {view === "assign-position" && (
            <div>
              <p className="font-body text-[11px] text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">
                Assign to which position?
              </p>
              <div className="px-3 pb-2">
                <label className="font-body text-[11px] text-steel">
                  Start date
                  <input
                    type="date"
                    value={assignStartDate}
                    onChange={(e) => setAssignStartDate(e.target.value)}
                    className="w-full h-8 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
                  />
                </label>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {positions === null && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">Loading…</p>
                )}
                {positions?.length === 0 && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">
                    No positions with players assigned yet — set this up from the Team page.
                  </p>
                )}
                {positions?.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAssignToPosition(p)}
                    className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50 disabled:opacity-40"
                  >
                    {busy ? assignProgress ?? "Assigning…" : `${p.name} (${p.athleteCount})`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {view === "assign-position-result" && bulkResult && (
            <div className="p-3">
              <p className="font-body text-sm text-chalk">
                Assigned to {bulkResult.succeeded} of {bulkResult.total} athletes on{" "}
                {bulkResult.positionName}.
              </p>
              {bulkResult.failedNames.length > 0 && (
                <p className="font-body text-xs text-rust mt-1.5">
                  Failed: {bulkResult.failedNames.join(", ")}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setView(null);
                  setBulkResult(null);
                  router.refresh();
                }}
                className="w-full h-8 mt-2.5 bg-rust text-graphite font-body text-xs font-medium"
              >
                Done
              </button>
            </div>
          )}

          {view === "duplicate-org" && (
            <div>
              <p className="font-body text-[11px] text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">
                Which organization?
              </p>
              <div className="max-h-72 overflow-y-auto">
                {orgs === null && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">Loading…</p>
                )}
                {orgs?.length === 0 && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">
                    No other organizations you own or admin.
                  </p>
                )}
                {orgs?.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => loadGroupsForOrg(o.id)}
                    className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {view === "duplicate-group" && (
            <div>
              <p className="font-body text-[11px] text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">
                Which group?
              </p>
              <div className="max-h-72 overflow-y-auto">
                {orgGroups === null && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">Loading…</p>
                )}
                {orgGroups?.length === 0 && (
                  <p className="font-body text-xs text-steel px-3 py-2.5">No groups in that organization yet.</p>
                )}
                {orgGroups?.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleDuplicateToGroup(g.id)}
                    className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50 disabled:opacity-40"
                  >
                    {busy ? "Duplicating…" : g.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setView("duplicate-org")}
                className="w-full text-left px-3 py-2 font-body text-[11px] text-steel border-t border-steel/15"
              >
                ← Back to organizations
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
