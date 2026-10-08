"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

const SUGGESTIONS = ["Main", "Mobility", "Warm-up", "Conditioning"];

// Shown inline in the program's button row (not as a block of its own). When a client has more than one program running (a main program, mobility on
// off days, a warm-up), this is how the coach tells them apart: a short label
// the athlete sees on each card, and the order the cards appear in. Both are
// optional. With neither set, a program shows under its own name, oldest first.
export function ProgramRoleControl({
  programId,
  initialLabel,
  initialSortOrder,
  available,
}: {
  programId: string;
  initialLabel: string | null;
  initialSortOrder: number | null;
  // False until the database update that adds the two columns has been applied.
  available: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(initialLabel ?? "");
  const [order, setOrder] = useState(initialSortOrder != null ? String(initialSortOrder) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = label.trim() !== (initialLabel ?? "") || order.trim() !== (initialSortOrder != null ? String(initialSortOrder) : "");

  async function save() {
    setError(null);
    setMessage(null);
    const trimmedOrder = order.trim();
    const parsedOrder = trimmedOrder === "" ? null : Number(trimmedOrder);
    if (parsedOrder !== null && (!Number.isInteger(parsedOrder) || parsedOrder < 0 || parsedOrder > 99)) {
      setError("Order must be a whole number from 0 to 99, or empty.");
      return;
    }
    setBusy(true);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("programs")
      .update({ label: label.trim() === "" ? null : label.trim(), sort_order: parsedOrder })
      .eq("id", programId);
    setBusy(false);
    if (updateError) {
      setError("Couldn't save. Try again in a moment.");
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  if (!available) {
    return (
      <p className="font-body text-xs text-steel max-w-[40ch]">
        Labelling programs (Main, Mobility, Warm-up) turns on after the next database update.
      </p>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <input
        list="program-label-suggestions"
        aria-label="Label: what the client sees on this program's card"
        title="The label is what the client sees on each card when they have more than one program."
        value={label}
        maxLength={30}
        onChange={(e) => {
          setLabel(e.target.value);
          setMessage(null);
        }}
        placeholder="Label"
        className="w-32 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
      />
      <datalist id="program-label-suggestions">
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <input
        type="number"
        inputMode="numeric"
        aria-label="Order: which program comes first (1 is first)"
        title="The order sets which program comes first for the client (1 is first)."
        min={0}
        max={99}
        value={order}
        onChange={(e) => {
          setOrder(e.target.value);
          setMessage(null);
        }}
        placeholder="Order"
        className="w-20 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
      />
      <button
        type="button"
        onClick={save}
        disabled={busy || !dirty}
        className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {message && <span className="font-body text-xs text-positive">{message}</span>}
      {error && (
        <span className="font-body text-xs text-rust" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
