"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2, Plus } from "lucide-react";

export interface SessionTypeRow {
  id: string;
  name: string;
  creditCost: number;
}

// gym_owner_multi_trainer_session_tracking_real_prospect.md — most
// coaches never touch this at all (every session stays the implicit,
// unnamed "training session" at cost 1). This exists only for the coach
// who wants to log an admin/internal session (a scheduling call, a
// non-billable check-in) without it silently spending a client's
// pre-paid credit — set that type's cost to 0.
export function SessionTypeManager({ initialTypes }: { initialTypes: SessionTypeRow[] }) {
  const router = useRouter();
  const [types, setTypes] = useState(initialTypes);
  const [name, setName] = useState("");
  const [creditCost, setCreditCost] = useState("1");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    const trimmed = name.trim();
    const cost = Number(creditCost);
    if (!trimmed || busy || !Number.isFinite(cost) || cost < 0) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const { data } = await supabase
      .from("session_types")
      .insert({ coach_id: user.id, name: trimmed, credit_cost: Math.round(cost) })
      .select("id, name, credit_cost")
      .single();
    if (data) {
      setTypes((prev) => [...prev, { id: data.id, name: data.name, creditCost: data.credit_cost }]);
      setName("");
      setCreditCost("1");
      router.refresh();
    }
    setBusy(false);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this session type? Existing logged sessions keep their history either way.")) return;
    const supabase = createBrowserClient();
    await supabase.from("session_types").delete().eq("id", id);
    setTypes((prev) => prev.filter((t) => t.id !== id));
    router.refresh();
  }

  return (
    <div className="max-w-2xl">
      <p className="font-body text-sm text-steel mb-4 max-w-[60ch]">
        Every in-person session you log spends 1 credit by default — you never have to set anything up. Create a type
        here only if you want an admin/internal session (a scheduling call, a non-billable check-in) to spend 0.
      </p>

      {types.length > 0 && (
        <div className="divide-y divide-steel/15 border-y border-steel/15 mb-4">
          {types.map((t) => (
            <div key={t.id} className="py-2.5 flex items-center justify-between">
              <span className="font-body text-sm">{t.name}</span>
              <div className="flex items-center gap-3">
                <span className="font-body text-xs text-steel">
                  {t.creditCost} {t.creditCost === 1 ? "credit" : "credits"}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(t.id)}
                  aria-label={`Delete ${t.name}`}
                  className="text-steel active:text-rust"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="font-body text-[11px] text-steel uppercase tracking-wide">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Check-in"
            className="h-10 w-56 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-body text-[11px] text-steel uppercase tracking-wide">Credit cost</label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={creditCost}
            onChange={(e) => setCreditCost(e.target.value)}
            className="h-10 w-24 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !name.trim()}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Add type
        </button>
      </div>
    </div>
  );
}
