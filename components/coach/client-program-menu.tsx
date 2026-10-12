"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { removeOwnProgramMessage, removeProgramMessage } from "@/lib/program-archive";

// The small three-dot menu on a program row in a client's Programs tab. It never opens the program (it sits beside the row's link, not inside it). "Make inactive / Make active" is
// the existing switch. "Remove from this profile" takes the copy off the client's profile without deleting anything: the program, its workouts and every log stay, the client no
// longer sees it, and it can be put back. The real delete is on the Programs page.
export function ClientProgramMenu({
  programId,
  programName,
  clientName,
  isActive,
  aiDraft,
  self = false,
  onRename,
}: {
  programId: string;
  programName: string;
  clientName: string;
  isActive: boolean;
  aiDraft: boolean;
  // The person's own list in My training: one option only, "Remove from my profile".
  self?: boolean;
  // Opens the name for editing in place (on the row that holds this menu).
  onRename?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggleActive() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase.from("programs").update({ is_active: !isActive }).eq("id", programId);
    setBusy(false);
    if (updateError) {
      setError("Couldn't change that. Try again.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function removeFromProfile() {
    if (busy) return;
    if (!(await confirmDialog({ message: self ? removeOwnProgramMessage(programName) : removeProgramMessage(programName, clientName), confirmLabel: "Remove" }))) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    // Inactive and removed in the same update: the database refuses a removed program that is still active.
    const { data: removed, error: updateError } = await supabase.from("programs").update({ is_active: false, archived_at: new Date().toISOString() }).eq("id", programId).select("id");
    setBusy(false);
    // Row security matches zero rows without an error when the person may not change it, so an empty result is a failure too.
    if (updateError || !removed || removed.length === 0) {
      setError("Couldn't remove it. Try again.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const item = "block w-full text-left px-3 min-h-11 font-body text-sm hover:bg-graphite/50 disabled:opacity-40";
  return (
    <div className="relative shrink-0" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Options for ${programName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-11 h-11 flex items-center justify-center text-steel hover:text-chalk"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-30 w-56 border border-steel/30 bg-surface shadow-lg">
          {onRename && (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onRename();
              }}
              className={`${item} text-chalk`}
            >
              Rename
            </button>
          )}
          {!aiDraft && !self && (
            <button type="button" role="menuitem" disabled={busy} onClick={toggleActive} className={`${item} text-chalk`}>
              {isActive ? "Make inactive" : "Make active"}
            </button>
          )}
          <button type="button" role="menuitem" disabled={busy} onClick={removeFromProfile} className={`${item} text-rust ${aiDraft || self ? "" : "border-t border-steel/15"}`}>
            {self ? "Remove from my profile" : `Remove from ${clientName.trim() || "this client"}`}
          </button>
          {error && (
            <p className="px-3 py-2 font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
