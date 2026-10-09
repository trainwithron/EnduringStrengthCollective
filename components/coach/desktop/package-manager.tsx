"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { confirmDialog } from "@/components/shared/confirm-dialog";

export interface CoachPackageRow {
  id: string;
  // The group the package was made in (it can differ from the page's group); editing it names this one.
  groupId?: string;
  name: string;
  sessionsPerWeek: number;
  billingType: "subscription" | "one_time";
  sessionsGranted: number;
  rateCents: number;
  isActive: boolean;
  isPublic: boolean;
  defaultProgramId: string | null;
  groupAccessGroupId?: string | null;
}

export interface AccessGroupOption {
  id: string;
  name: string;
}

export interface LinkableProgramOption {
  id: string;
  name: string;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PackageManager({
  groupId,
  initialPackages,
  linkablePrograms,
  accessGroups = [],
}: {
  groupId: string;
  initialPackages: CoachPackageRow[];
  linkablePrograms: LinkableProgramOption[];
  accessGroups?: AccessGroupOption[];
}) {
  const [packages, setPackages] = useState(initialPackages);
  const [name, setName] = useState("");
  const [sessionsPerWeek, setSessionsPerWeek] = useState("3");
  const [billingType, setBillingType] = useState<"subscription" | "one_time">("subscription");
  const [sessionsGranted, setSessionsGranted] = useState("12");
  const [ratePerSession, setRatePerSession] = useState("95");
  const [isPublic, setIsPublic] = useState(false);
  const [defaultProgramId, setDefaultProgramId] = useState("");
  const [groupAccessGroupId, setGroupAccessGroupId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // A failed publish toggle or deactivate, shown above the list (the form's own error is in the side panel).
  const [rowError, setRowError] = useState<string | null>(null);

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
          isPublic,
          defaultProgramId: defaultProgramId || null,
          groupAccessGroupId: groupAccessGroupId || null,
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
            isPublic,
            defaultProgramId: defaultProgramId || null,
            groupAccessGroupId: groupAccessGroupId || null,
          },
        ].sort((a, b) => a.sessionsPerWeek - b.sessionsPerWeek || a.billingType.localeCompare(b.billingType))
      );
      setName("");
      setIsPublic(false);
      setDefaultProgramId("");
      setGroupAccessGroupId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the package.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTogglePublic(pkg: CoachPackageRow) {
    setBusyId(pkg.id);
    setRowError(null);
    try {
      const res = await fetch("/api/coach/packages", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id, groupId: pkg.groupId ?? groupId, isPublic: !pkg.isPublic }),
      });
      if (res.ok) {
        setPackages((prev) => prev.map((p) => (p.id === pkg.id ? { ...p, isPublic: !pkg.isPublic } : p)));
      } else {
        const data = await res.json().catch(() => ({}));
        setRowError(data.error || "That didn't save. Nothing was changed. Try again.");
      }
    } catch {
      setRowError("That didn't save. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeactivate(id: string) {
    if (!(await confirmDialog({ message: "Deactivate this package? New clients can no longer pick it. Anyone who already bought it keeps what they bought.", confirmLabel: "Deactivate", destructive: true }))) return;
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch("/api/coach/packages", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: id, groupId: packages.find((p) => p.id === id)?.groupId ?? groupId }),
      });
      if (res.ok) {
        setPackages((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: false } : p)));
      } else {
        const data = await res.json().catch(() => ({}));
        setRowError(data.error || "That didn't deactivate. Nothing was changed. Try again.");
      }
    } catch {
      setRowError("That didn't deactivate. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  const active = packages.filter((p) => p.isActive);
  const inactive = packages.filter((p) => !p.isActive);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 lg:gap-10 items-start">
      <div>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
          Your packages
        </h2>
        {rowError && (
          <p className="font-body text-sm text-rust mb-3" role="alert">
            {rowError}
          </p>
        )}
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
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">Visibility</th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">Program</th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">Group</th>
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
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => handleTogglePublic(p)}
                      disabled={busyId === p.id}
                      className={`font-body text-xs uppercase tracking-wide disabled:opacity-40 ${
                        p.isPublic ? "text-positive" : "text-steel"
                      }`}
                      title={
                        p.isPublic
                          ? "Visible to every client — click to make private"
                          : "Only visible to clients you assign it to — click to publish"
                      }
                    >
                      {p.isPublic ? "Published" : "Private"}
                    </button>
                  </td>
                  <td className="py-3 font-body text-xs text-steel">
                    {p.defaultProgramId ? linkablePrograms.find((prog) => prog.id === p.defaultProgramId)?.name ?? "Linked" : "—"}
                  </td>
                  <td className="py-3 font-body text-xs text-steel">
                    {p.groupAccessGroupId ? accessGroups.find((g) => g.id === p.groupAccessGroupId)?.name ?? "Linked" : "—"}
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
          <p className="font-body text-xs text-steel mt-4">
            {inactive.length} deactivated package{inactive.length === 1 ? "" : "s"} — hidden from clients, kept for
            purchase history.
          </p>
        )}
      </div>

      <div className="border border-steel/20 p-4 space-y-3">
        <p className="font-display uppercase text-xs tracking-wide text-steel">Add a package</p>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 3x/week Subscription"
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Sessions / week (tier label)</span>
          <input
            type="number"
            min={1}
            value={sessionsPerWeek}
            onChange={(e) => setSessionsPerWeek(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Billing type</span>
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
          <span className="font-body text-xs text-steel uppercase tracking-wide">
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
          <span className="font-body text-xs text-steel uppercase tracking-wide">Rate per session ($)</span>
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
          <p className="font-body text-xs text-steel">
            Client pays ${previewTotal}
            {billingType === "subscription" ? "/month" : " total"}
          </p>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            Link a program (optional)
          </span>
          <select
            value={defaultProgramId}
            onChange={(e) => setDefaultProgramId(e.target.value)}
            className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
          >
            <option value="">No program — credits only</option>
            {linkablePrograms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="font-body text-xs text-steel">
            A client who buys or is assigned this package gets their own personal copy of this program automatically.
          </span>
        </label>
        {accessGroups.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">Group access (optional)</span>
            <select
              value={groupAccessGroupId}
              onChange={(e) => setGroupAccessGroupId(e.target.value)}
              className="h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs"
            >
              <option value="">No group access</option>
              {accessGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <span className="font-body text-xs text-steel">
              A client who buys or is assigned this package joins this group and sees its programs. If a subscription ends, the group access ends; their program copy stays.
            </span>
          </label>
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="accent-rust"
          />
          <span className="font-body text-xs text-steel">
            Publish to all clients — leave unchecked to assign privately per client
          </span>
        </label>
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
