"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

export interface CoachPackageRow {
  id: string;
  name: string;
  sessionsPerWeek: number;
  billingType: "subscription" | "one_time";
  sessionsGranted: number;
  rateCents: number;
  isActive: boolean;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PackageManager({
  groupId,
  initialPackages,
}: {
  groupId: string;
  initialPackages: CoachPackageRow[];
}) {
  const [packages, setPackages] = useState(initialPackages);
  const [name, setName] = useState("");
  const [sessionsPerWeek, setSessionsPerWeek] = useState("3");
  const [billingType, setBillingType] = useState<"subscription" | "one_time">("subscription");
  const [sessionsGranted, setSessionsGranted] = useState("12");
  const [ratePerSession, setRatePerSession] = useState("95");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const previewTotal =
    Number(ratePerSession) > 0 && Number(sessionsGranted) > 0
      ? (Number(ratePerSession) * Number(sessionsGranted)).toFixed(2)
      : null;

  async function handleAdd() {
    setError(null);
    const rateCents = Math.round(Number(ratePerSession) * 100);
    if (!name.trim() || rateCents <= 0 || Number(sessionsGranted) <= 0 || Number(sessionsPerWeek) <= 0) {
      setError("Fill in every field with a value greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/coach/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId,
          name: name.trim(),
          sessionsPerWeek: Number(sessionsPerWeek),
          billingType,
          sessionsGranted: Number(sessionsGranted),
          rateCents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create the package.");

      setPackages((prev) =>
        [
          ...prev,
          {
            id: data.packageId,
            name: name.trim(),
            sessionsPerWeek: Number(sessionsPerWeek),
            billingType,
            sessionsGranted: Number(sessionsGranted),
            rateCents,
            isActive: true,
          },
        ].sort((a, b) => a.sessionsPerWeek - b.sessionsPerWeek || a.billingType.localeCompare(b.billingType))
      );
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the package.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(id: string) {
    setBusyId(id);
    try {
      await fetch("/api/coach/packages", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: id, groupId }),
      });
      setPackages((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: false } : p)));
    } finally {
      setBusyId(null);
    }
  }

  const active = packages.filter((p) => p.isActive);
  const inactive = packages.filter((p) => !p.isActive);

  return (
    <div className="grid grid-cols-[1fr_340px] gap-10 items-start">
      <div>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
          Your packages
        </h2>
        {active.length === 0 ? (
          <p className="font-body text-sm text-steel py-3">
            No packages yet — add your first tier on the right.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-steel/20">
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">Package</th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">Tier</th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">Billing</th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">Rate</th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">Total</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id} className="border-b border-steel/15">
                  <td className="py-3 font-body text-sm">{p.name}</td>
                  <td className="py-3 font-body text-sm text-steel">{p.sessionsPerWeek}x/week</td>
                  <td className="py-3 font-body text-sm text-steel">
                    {p.billingType === "subscription" ? "Subscription" : "One-time"}
                  </td>
                  <td className="py-3 font-body text-sm text-steel">{formatDollars(p.rateCents)}/session</td>
                  <td className="py-3 font-body text-sm text-steel">
                    {formatDollars(p.rateCents * p.sessionsGranted)}
                    {p.billingType === "subscription" ? "/mo" : ""}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDeactivate(p.id)}
                      disabled={busyId === p.id}
                      aria-label="Deactivate package"
                      className="w-8 h-8 inline-flex items-center justify-center text-steel active:text-rust transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {inactive.length > 0 && (
          <p className="font-body text-[11px] text-steel mt-4">
            {inactive.length} deactivated package{inactive.length === 1 ? "" : "s"} — hidden from clients, kept for
            purchase history.
          </p>
        )}
      </div>

      <div className="border border-steel/20 p-4 space-y-3">
        <p className="font-display uppercase text-xs tracking-wide text-steel">Add a package</p>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 3x/week Subscription"
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Sessions / week (tier label)</span>
          <input
            type="number"
            min={1}
            value={sessionsPerWeek}
            onChange={(e) => setSessionsPerWeek(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Billing type</span>
          <select
            value={billingType}
            onChange={(e) => setBillingType(e.target.value as "subscription" | "one_time")}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          >
            <option value="subscription">Recurring subscription (monthly)</option>
            <option value="one_time">One-time package</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">
            Sessions granted {billingType === "subscription" ? "per month" : "total"}
          </span>
          <input
            type="number"
            min={1}
            value={sessionsGranted}
            onChange={(e) => setSessionsGranted(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Rate per session ($)</span>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={ratePerSession}
            onChange={(e) => setRatePerSession(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        {previewTotal && (
          <p className="font-body text-[11px] text-steel">
            Client pays ${previewTotal}
            {billingType === "subscription" ? "/month" : " total"}
          </p>
        )}
        <button
          type="button"
          onClick={handleAdd}
          disabled={submitting}
          className="w-full h-9 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {submitting ? "Creating…" : "Add package"}
        </button>
        {error && <p className="font-body text-xs text-rust">{error}</p>}
      </div>
    </div>
  );
}
