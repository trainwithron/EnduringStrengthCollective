"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { DeleteClientControl } from "@/components/coach/delete-client-control";
import { useTerm } from "@/components/coach/terminology-provider";

// The small three-dot menu on a client's card and on a row of the Clients list: exactly two actions, the same two the client's own profile has.
//   * Set inactive: the existing set_client_inactive call (nothing is deleted; a workout, session or message from them brings them back). A client already set aside shows "Bring back" instead.
//   * Delete client: the existing delete dialog (typed name, history choice), opened here, not a second one.
// It sits beside the card's link, never inside it, so opening it does not open the client.
export function ClientRowMenu({ groupId, athleteId, athleteName, setAside = false }: { groupId: string; athleteId: string; athleteName: string; setAside?: boolean }) {
  const term = useTerm();
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open && !deleting) return;
    const onDown = (e: MouseEvent) => {
      if (open && boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setDeleting(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, deleting]);

  async function toggleInactive() {
    setOpen(false);
    const noun = term("client");
    const message = setAside
      ? `Bring ${athleteName} back? They show on your dashboard and in quiet-${noun} alerts again.`
      : `Set ${athleteName} aside as inactive? They are hidden from your dashboard and quiet-${noun} alerts. Nothing is deleted, and a workout, session or message from them brings them back.`;
    if (!(await confirmDialog({ message, confirmLabel: setAside ? "Bring back" : "Set inactive" }))) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("set_client_inactive", { p_athlete_id: athleteId, p_group_id: groupId, p_inactive: !setAside, p_note: null });
    setBusy(false);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    router.refresh();
  }

  const item = "w-full text-left min-h-11 px-3 font-body text-sm text-chalk hover:bg-graphite/60 focus:bg-graphite/60 focus:outline-none";

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Actions for ${athleteName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="w-11 h-11 flex items-center justify-center text-steel hover:text-chalk focus:outline-none focus-visible:ring-1 focus-visible:ring-rust disabled:opacity-40"
      >
        <MoreVertical className="w-5 h-5" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-0.5 w-48 border border-steel/30 bg-surface shadow-lg">
          <button type="button" role="menuitem" onClick={() => void toggleInactive()} className={item}>
            {setAside ? "Bring back" : "Set inactive"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDeleting(true);
            }}
            className={`${item} text-rust`}
          >
            Delete {term("client")}
          </button>
        </div>
      )}
      {error && (
        <p className="absolute right-0 top-full z-30 mt-0.5 w-56 bg-graphite border border-rust p-2 font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Delete ${athleteName}`}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-graphite">
            <DeleteClientControl groupId={groupId} athleteId={athleteId} athleteName={athleteName} defaultOpen onCancel={() => setDeleting(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
