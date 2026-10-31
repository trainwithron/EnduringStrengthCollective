"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SessionCreditsControl } from "@/components/coach/session-credits-control";

export interface SessionLedgerRow {
  athleteId: string;
  groupId: string;
  athleteName: string;
  trainerName: string;
  groupName: string;
  balance: number | null;
}

const balanceClass = (b: number | null) => (b === null ? "text-steel" : b <= 1 ? "text-rust" : b <= 3 ? "text-yellow-500" : "text-chalk");

// The organization's session ledger. Tapping a client opens a small box right under the row with the same sessions control as their profile (Ron, Oct 31: "when i click a client
// name it should allow me to adjust their session count from that screen instead of taking me to their client profile ... a small floaty pop up"). The profile is one link inside it.
export function SessionLedgerRows({ rows }: { rows: SessionLedgerRow[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenKey(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // The confirm dialog for taking a session away sits outside the box; a click in it must not close the box.
      if (boxRef.current?.contains(t) || t.closest("[role=dialog], [role=alertdialog]")) return;
      setOpenKey(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [openKey]);

  return (
    <>
      {rows.map((r) => {
        const key = `${r.athleteId}::${r.groupId}`;
        const open = openKey === key;
        return (
          <div key={key} className="relative">
            <button
              type="button"
              onClick={() => setOpenKey(open ? null : key)}
              aria-expanded={open}
              className={`w-full text-left grid grid-cols-[1fr_180px_140px_120px] gap-3 py-2.5 font-body text-sm hover:bg-surface/40 ${open ? "bg-surface/40" : ""}`}
            >
              <span className="truncate">{r.athleteName}</span>
              <span className="text-steel truncate">{r.trainerName}</span>
              <span className="text-steel truncate">{r.groupName}</span>
              <span className={`text-right font-medium ${balanceClass(r.balance)}`}>{r.balance === null ? "No package" : r.balance}</span>
            </button>
            {open && (
              <div
                ref={boxRef}
                role="group"
                aria-label={`Sessions for ${r.athleteName}`}
                className="absolute right-0 top-full z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] bg-graphite border border-steel/30 shadow-lg p-4 space-y-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-body text-sm text-chalk font-medium truncate">{r.athleteName}</p>
                  <button type="button" onClick={() => setOpenKey(null)} className="font-body text-xs text-steel min-h-11 sm:min-h-0">
                    Close
                  </button>
                </div>
                <SessionCreditsControl key={key} athleteId={r.athleteId} groupId={r.groupId} initialBalance={r.balance ?? 0} />
                <Link href={`/groups/${r.groupId}/athletes/${r.athleteId}`} className="inline-flex min-h-11 sm:min-h-0 items-center font-body text-xs text-rust underline underline-offset-2">
                  Open profile
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
