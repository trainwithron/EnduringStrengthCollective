"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

const SUGGESTIONS = ["Main", "Mobility", "Warm-up", "Conditioning"];

// When a client has more than one program running (a main program, mobility on
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
      <div className="border border-steel/20 bg-surface/40 p-4 mb-5">
        <h3 className="font-display uppercase text-sm tracking-wide">Label and order</h3>
        <p className="font-body text-xs text-steel mt-1 max-w-[60ch]">
          Labelling programs (Main, Mobility, Warm-up) turns on after the next database update. Until then each
          program shows under its own name, oldest first.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-steel/20 bg-surface/40 p-4 mb-5">
      <h3 className="font-display uppercase text-sm tracking-wide">Label and order</h3>
      <p className="font-body text-xs text-steel mt-1 max-w-[60ch]">
        If this client has more than one program running, the label is what they see on each card and the order sets
        which comes first (1 is first).
      </p>
      <div className="grid grid-cols-2 gap-3 mt-3 max-w-md">
        <label className="block">
          <span className="font-body text-xs text-steel">Label</span>
          <input
            list="program-label-suggestions"
            value={label}
            maxLength={30}
            onChange={(e) => {
              setLabel(e.target.value);
              setMessage(null);
            }}
            placeholder="e.g. Mobility"
            className="mt-1 w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <datalist id="program-label-suggestions">
            {SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel">Order</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            value={order}
            onChange={(e) => {
              setOrder(e.target.value);
              setMessage(null);
            }}
            placeholder="1"
            className="mt-1 w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {message && <span className="font-body text-xs text-positive">{message}</span>}
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
