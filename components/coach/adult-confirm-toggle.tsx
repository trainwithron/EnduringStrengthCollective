"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "18 or older (no birthday on file)" (step 230): coach-only, on the client's page, shown only while no birthday is on file. Ticked, the client gets everything an adult gets
// (full name on boards, macro comparisons, the builder without the youth limits); a birthday added later always decides instead.
export function AdultConfirmToggle({ athleteId, initial }: { athleteId: string; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function change(next: boolean) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    setOn(next);
    try {
      const res = await fetch("/api/clients/adult-confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ athleteId, confirmed: next }) });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setOn(!next);
        setNote(d.error ?? "That didn't save. Try again.");
      } else {
        router.refresh();
      }
    } catch {
      setOn(!next);
      setNote("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-adult-confirm>
      <label className="flex items-center gap-2 min-h-11 font-body text-sm text-chalk cursor-pointer">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} className="w-4 h-4 accent-rust" />
        18 or older (no birthday on file)
      </label>
      <p className="font-body text-xs text-steel">Without a birthday, an unknown age is treated as under 18. Tick this if you know they are an adult.</p>
      {note && (
        <p className="font-body text-xs text-rust-ink mt-1" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
