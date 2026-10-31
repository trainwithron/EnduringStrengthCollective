"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { ShelfPlacementControls } from "@/components/coach/desktop/shelf-placement-controls";
import { isAudience, type Audience } from "@/lib/shelf";
import { CHECKIN_LABEL, PACKAGE_KIND_LABEL, kindOf, packagePriceCents, type PackageKind } from "@/lib/package-price";

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
  // The one product shelf (release BX): where it shows and who sees it in the app.
  showOnHome?: boolean;
  showInProShop?: boolean;
  audience?: string | null;
  audienceGroupId?: string | null;
  buyerJoinsSpace?: boolean;
  // The package builder (0440): what it is, its own price, and for coaching how often check-ins are.
  kind?: string | null;
  priceCents?: number | null;
  checkinWeeks?: number | null;
}

export interface AccessGroupOption {
  id: string;
  name: string;
}

export interface LinkableProgramOption {
  id: string;
  name: string;
}

type SoldAs = "single" | "pack" | "weekly";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

const KIND_BLURB: Record<PackageKind, string> = {
  team: "Join a group that runs one program together, week by week, with leaderboards.",
  program: "Their own copy of a program to run on their own.",
  coaching: "A program built for them, with check-ins and messages.",
  sessions: "Sessions with you, one at a time, in a pack, or every week.",
};
const KINDS: PackageKind[] = ["team", "program", "coaching", "sessions"];

const labelCls = "font-body text-xs text-steel uppercase tracking-wide";
const inputCls = "h-10 px-2.5 bg-surface border border-steel/30 text-chalk font-body text-sm w-full focus:outline-none focus:border-rust";
const segCls = (on: boolean) => `min-h-9 px-3 border font-body text-sm ${on ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"}`;

// What a saved package is, in one line for the list.
function detailLine(p: CoachPackageRow, programs: LinkableProgramOption[], groups: AccessGroupOption[]): string {
  const kind = kindOf(p);
  if (kind === "team") return `${PACKAGE_KIND_LABEL.team} · ${groups.find((g) => g.id === p.groupAccessGroupId)?.name ?? "a group"}`;
  if (kind === "program") return `${PACKAGE_KIND_LABEL.program} · ${programs.find((x) => x.id === p.defaultProgramId)?.name ?? "a program"}`;
  if (kind === "coaching") return `${PACKAGE_KIND_LABEL.coaching}${p.checkinWeeks ? ` · check-ins ${CHECKIN_LABEL[p.checkinWeeks].toLowerCase()}` : ""}`;
  const per = `${dollars(p.rateCents)} a session`;
  if (p.billingType === "subscription") return `In-person · ${p.sessionsPerWeek}x a week · ${per}`;
  return `In-person · ${p.sessionsGranted === 1 ? "one session" : `pack of ${p.sessionsGranted}`} · ${per}`;
}

// The package builder (Ron, Oct 31: "the package builder needs a revamp"; mockup approved the same day). The first question is what is being sold, and each kind asks only for what it
// needs: a training team (the buyer joins the group and runs its program with everyone), an online program (their own copy), online coaching (check-ins), or in-person sessions (one, a
// pack, or every week, priced per session). One plain price for the first three; sessions work out their own. A live card shows how it reads on the public page.
export function PackageManager({
  groupId,
  initialPackages,
  linkablePrograms,
  accessGroups = [],
  siteLinkBase = null,
}: {
  groupId: string;
  // The public page's address (for example https://app/c/my-name); with it a public package shows a link a coach can paste on their own website.
  siteLinkBase?: string | null;
  initialPackages: CoachPackageRow[];
  linkablePrograms: LinkableProgramOption[];
  accessGroups?: AccessGroupOption[];
}) {
  const [packages, setPackages] = useState(initialPackages);
  const [kind, setKind] = useState<PackageKind>("sessions");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [billingType, setBillingType] = useState<"subscription" | "one_time">("subscription");
  const [teamId, setTeamId] = useState(accessGroups[0]?.id ?? "");
  const [programId, setProgramId] = useState(linkablePrograms[0]?.id ?? "");
  const [checkinWeeks, setCheckinWeeks] = useState(2);
  const [soldAs, setSoldAs] = useState<SoldAs>("weekly");
  const [perSession, setPerSession] = useState("");
  const [count, setCount] = useState("2");
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [placementOpenId, setPlacementOpenId] = useState<string | null>(null);
  // The add form shows only after "Add a package".
  const [adding, setAdding] = useState(false);

  // What the form would save.
  const perCents = Math.round(Number(perSession) * 100);
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const flatCents = Math.round(Number(price) * 100);
  const sessionsShape =
    soldAs === "single"
      ? { billingType: "one_time" as const, sessionsGranted: 1, sessionsPerWeek: 1, total: perCents }
      : soldAs === "pack"
      ? { billingType: "one_time" as const, sessionsGranted: n, sessionsPerWeek: 1, total: perCents * n }
      : { billingType: "subscription" as const, sessionsGranted: n * 4, sessionsPerWeek: n, total: perCents * n * 4 };
  const previewCents = kind === "sessions" ? sessionsShape.total : flatCents;
  const previewUnit =
    kind === "sessions"
      ? soldAs === "single"
        ? "a session"
        : soldAs === "pack"
        ? `for ${n} sessions`
        : "a month"
      : billingType === "subscription"
      ? "a month"
      : "one time";
  const previewItems =
    kind === "team"
      ? ["Runs the team's program with everyone, week by week", "Team leaderboard and feed", "Every workout in the app"]
      : kind === "program"
      ? [`Their own copy of ${linkablePrograms.find((p) => p.id === programId)?.name ?? "the program"}`, "Every workout in the app", "Start any time"]
      : kind === "coaching"
      ? ["A program built for them", `Check-ins ${CHECKIN_LABEL[checkinWeeks].toLowerCase()}`, "Messages any time"]
      : [soldAs === "weekly" ? `${n} sessions a week with you` : soldAs === "pack" ? `${n} sessions with you` : "One session with you", "Their program and every workout in the app"];

  function pickKind(k: PackageKind) {
    setKind(k);
    setError(null);
    setSaved(null);
    if (k !== "sessions") setBillingType(k === "program" ? "one_time" : "subscription");
  }

  async function handleAdd() {
    setError(null);
    setSaved(null);
    if (!name.trim()) return setError("Give it a name.");
    if (kind === "team" && !teamId) return setError("Pick the team it gives access to.");
    if (kind === "program" && !programId) return setError("Pick the program they get.");
    if (kind === "sessions" ? perCents <= 0 : flatCents <= 0) return setError(kind === "sessions" ? "Set the price per session." : "Set the price.");

    const body =
      kind === "sessions"
        ? { billingType: sessionsShape.billingType, sessionsGranted: sessionsShape.sessionsGranted, sessionsPerWeek: sessionsShape.sessionsPerWeek, rateCents: perCents, priceCents: null }
        : { billingType, sessionsGranted: 0, sessionsPerWeek: 0, rateCents: flatCents, priceCents: flatCents };
    const extra = {
      defaultProgramId: kind === "program" ? programId : null,
      groupAccessGroupId: kind === "team" ? teamId : null,
      checkinWeeks: kind === "coaching" ? checkinWeeks : null,
    };
    setSubmitting(true);
    try {
      const res = await fetch("/api/coach/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, name: name.trim(), kind, isPublic, ...body, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't create the package.");
      setPackages((prev) => [...prev, { id: data.packageId, groupId, name: name.trim(), kind, isActive: true, isPublic, ...body, ...extra }]);
      setSaved(`Saved ${name.trim()}.`);
      setName("");
      setPrice("");
      setPerSession("");
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
    <div className="space-y-10">
      {/* The coach's packages as cards, with the add form behind one button (layout audit #8): the page opens on what they sell, not on an empty form. */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-display uppercase text-sm tracking-wide text-chalk">Your packages</h2>
          <button type="button" onClick={() => setAdding((a) => !a)} aria-expanded={adding} className={adding ? "min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm" : "min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium"}>
            {adding ? "Close" : "Add a package"}
          </button>
        </div>
        {adding && (
        <div className="mb-8 pb-8 border-b border-steel/20" data-add-package>
        <h2 className="font-display uppercase text-sm tracking-wide text-chalk mb-3">What are you selling?</h2>
        <div className="grid grid-cols-2 @3xl:grid-cols-4 gap-2.5" role="group" aria-label="Kind of package">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pickKind(k)}
              aria-pressed={kind === k}
              className={`text-left border p-3.5 flex flex-col gap-1 min-w-0 ${kind === k ? "border-rust bg-rust/10" : "border-steel/25 bg-surface/40 hover:border-steel/50"}`}
            >
              <span className={`font-display uppercase text-base leading-tight ${kind === k ? "text-rust" : "text-chalk"}`}>{PACKAGE_KIND_LABEL[k]}</span>
              <span className="font-body text-xs text-steel leading-snug">{KIND_BLURB[k]}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 @3xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6 mt-5 items-start">
          <div className="border border-steel/20 p-5 space-y-4">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={kind === "sessions" ? "In Person, 2x a Week" : kind === "team" ? "Enduring Strength Team" : kind === "program" ? "Online Program" : "Online Coaching"}
                className={inputCls}
              />
            </label>

            {kind === "team" &&
              (accessGroups.length > 0 ? (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Team</span>
                    <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={inputCls}>
                      {accessGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="border-l-2 border-rust bg-rust/10 px-3 py-2 font-body text-xs text-chalk">
                    A buyer joins this group and runs its program with everyone, the same workout each week, on the team leaderboard. If a monthly plan ends, the team access ends.
                  </p>
                </>
              ) : (
                <p className="font-body text-sm text-steel">You have no team or group to sell yet. Make one first, then come back.</p>
              ))}

            {kind === "program" &&
              (linkablePrograms.length > 0 ? (
                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>Program</span>
                  <select value={programId} onChange={(e) => setProgramId(e.target.value)} className={inputCls}>
                    {linkablePrograms.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <span className="font-body text-xs text-steel">They get their own copy and start at week 1 whenever they buy.</span>
                </label>
              ) : (
                <p className="font-body text-sm text-steel">No program to sell yet: only a program not made for one client can be sold. Build one first.</p>
              ))}

            {kind === "coaching" && (
              <div className="space-y-1.5">
                <span className={labelCls}>Check-ins</span>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 4].map((w) => (
                    <button key={w} type="button" onClick={() => setCheckinWeeks(w)} aria-pressed={checkinWeeks === w} className={segCls(checkinWeeks === w)}>
                      {CHECKIN_LABEL[w]}
                    </button>
                  ))}
                </div>
                <p className="font-body text-xs text-steel">You build their program after they join. Messages are always included.</p>
              </div>
            )}

            {kind === "sessions" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <span className={labelCls}>How it&apos;s sold</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["single", "One session"],
                        ["pack", "A pack"],
                        ["weekly", "Every week"],
                      ] as [SoldAs, string][]
                    ).map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setSoldAs(v)} aria-pressed={soldAs === v} className={segCls(soldAs === v)}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Price per session ($)</span>
                    <input type="number" min={1} step={1} inputMode="decimal" value={perSession} onChange={(e) => setPerSession(e.target.value)} placeholder="100" className={inputCls} />
                  </label>
                  {soldAs !== "single" && (
                    <label className="flex flex-col gap-1.5">
                      <span className={labelCls}>{soldAs === "pack" ? "Sessions in the pack" : "Sessions a week"}</span>
                      <input type="number" min={1} step={1} value={count} onChange={(e) => setCount(e.target.value)} className={inputCls} />
                    </label>
                  )}
                </div>
                {perCents > 0 && (
                  <p className="font-body text-xs text-steel tabular-nums">
                    {soldAs === "single"
                      ? "Paid one session at a time."
                      : soldAs === "pack"
                      ? `${n} × ${dollars(perCents)} = ${dollars(perCents * n)}, paid once. Each session uses one from the pack.`
                      : `${n} a week × ${dollars(perCents)} × 4 weeks = ${dollars(perCents * n * 4)} a month (${n * 4} sessions).`}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>Price ($)</span>
                  <input type="number" min={1} step={1} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={kind === "coaching" ? "200" : "99"} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelCls}>Charged</span>
                  <select value={billingType} onChange={(e) => setBillingType(e.target.value as "subscription" | "one_time")} className={inputCls}>
                    <option value="subscription">Every month</option>
                    <option value="one_time">One time</option>
                  </select>
                </label>
              </div>
            )}

            <label className="flex items-center gap-2 font-body text-sm text-chalk">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="w-4 h-4 accent-rust" />
              Show on my public page and to all my clients (unticked: you assign it to clients yourself)
            </label>
            <button type="button" onClick={handleAdd} disabled={submitting} className="w-full h-11 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              {submitting ? "Saving…" : "Save package"}
            </button>
            {error && (
              <p className="font-body text-xs text-rust" role="alert">
                {error}
              </p>
            )}
            {saved && (
              <p className="font-body text-xs text-positive" role="status">
                {saved}
              </p>
            )}
          </div>

          <div>
            <p className={`${labelCls} mb-2`}>How it looks on your page</p>
            <div className="bg-[#F2EEE6] text-[#1A1815] p-5 flex flex-col gap-1.5" aria-live="polite">
              <span className="font-body text-[11px] uppercase tracking-widest font-semibold text-[#8A6D08]">{PACKAGE_KIND_LABEL[kind]}</span>
              <span className="font-display font-bold uppercase text-2xl leading-tight break-words">{name.trim() || "Your package name"}</span>
              <span className="font-display font-bold text-4xl leading-none mt-1.5 tabular-nums">
                {previewCents > 0 ? dollars(previewCents) : "$—"} <span className="font-body font-medium text-sm text-[#5C574E]">{previewUnit}</span>
              </span>
              <ul className="list-disc pl-5 mt-2 font-body text-sm text-[#3B3730] space-y-0.5">
                {previewItems.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <p className="font-body text-xs text-steel mt-2.5">Buy buttons appear once payments are on. Until then you assign packages to clients yourself.</p>
          </div>
        </div>
        </div>
        )}
        {rowError && (
          <p className="font-body text-sm text-rust mb-3" role="alert">
            {rowError}
          </p>
        )}
        {active.length === 0 ? (
          <p className="font-body text-sm text-steel py-3">No packages yet. Choose Add a package to make one.</p>
        ) : (
          <div className="grid grid-cols-1 @3xl:grid-cols-2 @5xl:grid-cols-3 gap-3 items-start">
            {active.map((p) => (
              <div key={p.id} className={`border border-steel/20 bg-surface/40 p-4 flex flex-col gap-3 min-w-0 ${placementOpenId === p.id ? "@3xl:col-span-2 @5xl:col-span-3" : ""}`} data-package-card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-body text-sm text-chalk font-medium break-words">{p.name}</p>
                    <p className="font-body text-xs text-steel mt-0.5">{detailLine(p, linkablePrograms, accessGroups)}</p>
                  </div>
                  <span className="font-body text-sm text-chalk font-medium tabular-nums whitespace-nowrap text-right">
                    {dollars(packagePriceCents(p))}
                    <span className="text-steel font-normal">{p.billingType === "subscription" ? " / month" : " once"}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleTogglePublic(p)}
                      disabled={busyId === p.id}
                      className={`min-h-9 px-2.5 border font-body text-xs whitespace-nowrap disabled:opacity-40 ${p.isPublic ? "border-positive/60 text-positive" : "border-steel/30 text-steel"}`}
                      title={p.isPublic ? "On your public page and open to all clients. Click to make it private." : "Only clients you assign it to. Click to publish."}
                    >
                      {p.isPublic ? "Published" : "Private"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlacementOpenId(placementOpenId === p.id ? null : p.id)}
                      aria-expanded={placementOpenId === p.id}
                      className="font-body text-xs text-steel underline underline-offset-2 whitespace-nowrap"
                    >
                      Where it shows
                    </button>
                    {p.isPublic && siteLinkBase && (
                      <button type="button" onClick={() => navigator.clipboard?.writeText(`${siteLinkBase}#package-${p.id}`)} className="font-body text-xs text-steel underline underline-offset-2 whitespace-nowrap">
                        Copy link
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() => handleDeactivate(p.id)}
                    disabled={busyId === p.id}
                    aria-label={`Deactivate ${p.name}`}
                    className="hidden sm:inline-flex ml-auto w-9 h-9 items-center justify-center text-steel hover:text-rust transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {placementOpenId === p.id && (
                  <div>
                    <ShelfPlacementControls
                      target="package"
                      id={p.id}
                      isProgram={kindOf(p) === "program"}
                      publicChecked={p.isPublic}
                      onTogglePublic={() => handleTogglePublic(p)}
                      groups={accessGroups}
                      initial={{
                        showOnHome: p.showOnHome ?? false,
                        showInProShop: p.showInProShop ?? false,
                        audience: (isAudience(p.audience) ? p.audience : "everyone") as Audience,
                        audienceGroupId: p.audienceGroupId ?? null,
                        buyerJoinsSpace: p.buyerJoinsSpace !== false,
                      }}
                    />
                    <button type="button" onClick={() => handleDeactivate(p.id)} disabled={busyId === p.id} className="sm:hidden mt-2 min-h-11 font-body text-xs text-rust">
                      Deactivate this package
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {inactive.length > 0 && (
          <p className="font-body text-xs text-steel mt-4">
            {inactive.length} deactivated package{inactive.length === 1 ? "" : "s"}: hidden from clients, kept for purchase history.
          </p>
        )}
      </section>
    </div>
  );
}
