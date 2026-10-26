"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { scrollIsInsideMenu } from "@/lib/menu-scroll";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { clampedLeft, clampedWidth } from "@/lib/viewport-clamp";
import { duplicateProgram } from "@/lib/program-duplication";
import { keepOrgProgramMark } from "@/lib/org-programs";
import { ProgramAssignPanel } from "@/components/coach/desktop/program-assign-panel";
import { UseTemplatePanel } from "@/components/coach/desktop/use-template-panel";
import { assignedBlockMessage, loadAssignedTo } from "@/lib/program-assigned";
import { MoreVertical } from "lucide-react";
import { hideProgramMessage } from "@/lib/program-archive";

const MENU_WIDTH = 256;
// Never wider than the screen minus a margin on each side (a phone is narrower than the menu plus its margins).
function menuWidth(): number {
  return clampedWidth(MENU_WIDTH, typeof window === "undefined" ? MENU_WIDTH + 32 : window.innerWidth);
}

interface OrgOption {
  id: string;
  name: string;
}
interface GroupOption {
  id: string;
  name: string;
}
type View =
  | "menu"
  | "duplicate"
  | "duplicate-org"
  | "duplicate-group";

export function ProgramCardMenu({
  programId,
  programName,
  groupId,
  hideAssignAndDuplicate = false,
  aiDraft = false,
  showAssignButton = false,
  canHide = false,
  onRename,
  slotCount = 0,
}: {
  programId: string;
  programName: string;
  groupId: string;
  // An AI program not signed off yet: it cannot be assigned until it is (a copy of a draft would be a draft too).
  aiDraft?: boolean;
  // Real feedback from Ron: every action in this menu that creates a
  // NEW program and navigates into its builder (Assign to Client/
  // Position/Myself, both Duplicate variants) makes no sense from the
  // embedded copy inside ShellListPanel's side panel — the whole point
  // there is staying on your current page. Delete is a real in-place
  // action on this same program, so it stays either way.
  hideAssignAndDuplicate?: boolean;
  // A program in the library (no client, not active): a plain Assign button beside the menu.
  showAssignButton?: boolean;
  // A library program (no client on it) can be tucked away without deleting it.
  canHide?: boolean;
  // Opens the name for editing in place (on the card that holds this menu).
  onRename?: () => void;
  // A template (a program with slots) is made into a real program with "Use this template…"; it is never assigned as it is.
  slotCount?: number;
}) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [orgs, setOrgs] = useState<OrgOption[] | null>(null);
  const [orgGroups, setOrgGroups] = useState<GroupOption[] | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const isTemplate = slotCount > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rendered through a portal (see the return below) instead of a plain
  // absolutely-positioned child — every program card wraps its content in
  // overflow-hidden (to crop the cover image cleanly), which was clipping
  // this dropdown to whatever sliver of the card remained below the
  // trigger button, worse on smaller card sizes. A portal to <body>,
  // positioned from the trigger's real screen coordinates, escapes that
  // ancestor entirely.
  // The plain Assign button on a program in the library (no client yet): opens the same Assign panel as the menu's "Assign…".
  function openAssign() {
    setAssignOpen(true);
  }

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({ top: rect.bottom + 4, left: clampedLeft(rect.right - MENU_WIDTH, clampedWidth(MENU_WIDTH, window.innerWidth), window.innerWidth) });
    }
    setView("menu");
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      // The in-page confirmation (Delete? Assign?) sits outside the menu, but answering it is not leaving the menu: closing here would hide the error or result the menu is about to show.
      if (target instanceof Element && target.closest('[role="alertdialog"]')) return;
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
    // Only the PAGE (or something outside the menu) scrolling closes it; scrolling the menu's own list, such as a long client list, must not.
    function handleScroll(e: Event) {
      if (scrollIsInsideMenu(menuRef.current, e.target)) return;
      setView(null);
    }
    function handleKeyDown(e: KeyboardEvent) {
      // Escape inside the confirmation closes only the confirmation.
      if (e.key === "Escape" && !document.querySelector('[role="alertdialog"]')) setView(null);
    }
    if (view) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [view]);

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
      // A copy goes to a team or social group, never into a client's own one-on-one space.
      .neq("group_kind", "one_on_one")
      .order("name");
    setOrgGroups(data ?? []);
    setView("duplicate-group");
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

    if (!("error" in result)) await keepOrgProgramMark(supabase, programId, result.programId);
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
    const supabase = createBrowserClient({ crossOrg: true });
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

  // Tidies the library without deleting anything: the program, its workouts and every log stay, and it can be put back from Hidden programs on the Programs page.
  async function handleHide() {
    if (!(await confirmDialog(hideProgramMessage(programName)))) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    // Inactive and hidden in the same update: the database refuses a hidden program that is still active.
    const { error: hideError } = await supabase.from("programs").update({ is_active: false, archived_at: new Date().toISOString() }).eq("id", programId);
    setBusy(false);
    if (hideError) {
      setError("Couldn't hide it. Try again.");
      return;
    }
    router.refresh();
  }

  async function handleDelete() {
    // A program that people have their own versions of is not deleted from under them: remove it from them first, or hide it.
    const assignedCount = (await loadAssignedTo(createBrowserClient(), programId)).length;
    if (assignedCount > 0) {
      setError(assignedBlockMessage(assignedCount));
      return;
    }
    if (!await confirmDialog(`Delete "${programName}"? Any real logged history stays intact.`)) return;
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
    <div className="relative flex items-center gap-1">
      {showAssignButton && !isTemplate && (
        <button type="button" onClick={openAssign} className="min-h-11 px-2 font-body text-xs text-rust underline underline-offset-2">
          Assign
        </button>
      )}
      {isTemplate && !hideAssignAndDuplicate && (
        <button type="button" onClick={() => setTemplateOpen(true)} className="min-h-11 px-2 font-body text-xs text-rust underline underline-offset-2">
          Use template
        </button>
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (view ? setView(null) : openMenu())}
        aria-label="Program options"
        className="w-7 h-7 flex items-center justify-center text-steel active:text-rust transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {templateOpen && <UseTemplatePanel programId={programId} programName={programName} groupId={groupId} onClose={() => setTemplateOpen(false)} onChanged={() => router.refresh()} />}

      {assignOpen && (
        <ProgramAssignPanel programId={programId} programName={programName} groupId={groupId} aiDraft={aiDraft} onClose={() => setAssignOpen(false)} onChanged={() => router.refresh()} />
      )}

      {view && position && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: position.top, left: position.left, width: menuWidth(), maxHeight: "calc(100vh - 5rem)", overflowY: "auto" }}
          className="bg-surface border border-steel/30 z-50 shadow-lg"
        >
          {error && (
            <p className="font-body text-xs text-rust px-3 pt-2.5" role="alert">
              {error}
            </p>
          )}

          {view === "menu" && (
            <div>
              {onRename && (
                <button
                  type="button"
                  onClick={() => {
                    setView(null);
                    onRename();
                  }}
                  className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
                >
                  Rename
                </button>
              )}
              {!hideAssignAndDuplicate && (
                <>
                  {isTemplate ? (
                    <button
                      type="button"
                      onClick={() => {
                        setView(null);
                        setTemplateOpen(true);
                      }}
                      className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
                    >
                      Use this template…
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setView(null);
                        setAssignOpen(true);
                      }}
                      className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
                    >
                      Assign…
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setView("duplicate")}
                    className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
                  >
                    Duplicate…
                  </button>
                </>
              )}
              {canHide && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleHide}
                  className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50 disabled:opacity-40 border-t border-steel/15"
                >
                  Hide
                </button>
              )}
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

          {view === "duplicate" && (
            <div>
              <p className="font-body text-xs text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">Duplicate &ldquo;{programName}&rdquo;</p>
              <button
                type="button"
                disabled={busy}
                onClick={handleDuplicateSameGroup}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50 disabled:opacity-40"
              >
                {busy ? "Duplicating…" : "In my library"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("duplicate-org");
                  loadOrgs();
                }}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
              >
                In another organization →
              </button>
            </div>
          )}

          {view === "duplicate-org" && (
            <div>
              <p className="font-body text-xs text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">
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
              <p className="font-body text-xs text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">
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
                className="w-full text-left px-3 py-2 font-body text-xs text-steel border-t border-steel/15"
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
