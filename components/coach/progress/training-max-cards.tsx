"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { TrendChart } from "@/components/coach/desktop/trend-chart";
import { computeChartGeometry } from "@/lib/trend-chart-math";
import { hasGraph, type Metric, type SeriesPoint } from "@/lib/progress-cards";

export interface CardData {
  name: string;
  sessions: number;
  bestE1rm: number | null;
  bestWeight: number | null;
  weightSeries: SeriesPoint[];
  volumeSeries: SeriesPoint[];
  pinned: boolean;
}

const MAX_SHOWN_ALL = 60;

function Sparkline({ points }: { points: SeriesPoint[] }) {
  const geometry = computeChartGeometry(points, 120, 36, 3);
  if (!geometry) return null;
  const d = geometry.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = geometry.points[geometry.points.length - 1];
  return (
    <svg viewBox="0 0 120 36" className="w-full h-9" aria-hidden>
      <path d={d} fill="none" stroke="#D2703B" strokeWidth={1.75} />
      <circle cx={last.x} cy={last.y} r={2.5} fill="#D2703B" />
    </svg>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round">
      <path d="M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H7v-2l3-3-1-6z" />
    </svg>
  );
}

const segment = (active: boolean) => `min-h-11 px-3 font-body text-xs border border-steel/30 ${active ? "bg-chalk text-graphite" : "text-steel hover:text-chalk"}`;

// The client's estimated training maxes as cards. The order is predictable (see lib/progress-cards.ts): pinned first, then the big five, then everything else, most logged first; the small label says
// which. One quick switch for the whole section chooses weight or volume on the graphs, and cards or list is the coach's own choice, remembered on their account. A card with fewer than two logged
// days shows only the number. Tapping a card opens the full chart.
export function TrainingMaxCards({
  cards,
  visible,
  label,
  athleteId,
  groupId,
  coachId,
  initialView,
  initialMetric,
  canPin,
}: {
  cards: CardData[];
  visible: number;
  label: string;
  athleteId: string;
  groupId: string;
  coachId: string;
  initialView: "cards" | "list";
  initialMetric: Metric;
  canPin: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"cards" | "list">(initialView);
  const [metric, setMetric] = useState<Metric>(initialMetric);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pins, setPins] = useState<Set<string>>(() => new Set(cards.filter((c) => c.pinned).map((c) => c.name)));
  const [error, setError] = useState<string | null>(null);

  async function savePref(patch: { view_mode?: "cards" | "list"; metric?: Metric }) {
    const { error: problem } = await createBrowserClient().from("coach_progress_prefs").upsert({ coach_id: coachId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "coach_id" });
    if (problem) setError("Couldn't remember that choice. It still applies here.");
  }

  function chooseView(next: "cards" | "list") {
    setView(next);
    setError(null);
    void savePref({ view_mode: next });
  }
  function chooseMetric(next: Metric) {
    setMetric(next);
    setError(null);
    void savePref({ metric: next });
  }

  async function togglePin(name: string) {
    const supabase = createBrowserClient();
    const pinned = pins.has(name);
    setError(null);
    const next = new Set(pins);
    if (pinned) next.delete(name);
    else next.add(name);
    setPins(next);
    const result = pinned
      ? await supabase.from("client_progress_pins").delete().eq("coach_id", coachId).eq("athlete_id", athleteId).eq("exercise_name", name)
      : await supabase.from("client_progress_pins").insert({ coach_id: coachId, athlete_id: athleteId, group_id: groupId, exercise_name: name });
    if (result.error) {
      setPins(pins);
      setError(pinned ? "Couldn't unpin that. Try again." : "Couldn't pin that. Try again.");
      return;
    }
    router.refresh();
  }

  if (cards.length === 0) return null;
  const shown = showAll ? cards.slice(0, MAX_SHOWN_ALL) : cards.slice(0, visible);
  const seriesOf = (c: CardData) => (metric === "weight" ? c.weightSeries : c.volumeSeries);
  const expanded = open ? cards.find((c) => c.name === open) ?? null : null;

  return (
    <section aria-labelledby="training-max-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-2">
        <div>
          <h2 id="training-max-heading" className="font-display uppercase text-sm tracking-wide text-steel">
            Estimated Training Maxes
          </h2>
          <p className="font-body text-xs text-steel mt-0.5">{label}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label="Graph shows" className="flex">
            <button type="button" aria-pressed={metric === "weight"} onClick={() => chooseMetric("weight")} className={segment(metric === "weight")}>
              Weight
            </button>
            <button type="button" aria-pressed={metric === "volume"} onClick={() => chooseMetric("volume")} className={`${segment(metric === "volume")} -ml-px`}>
              Volume
            </button>
          </div>
          <div role="group" aria-label="Layout" className="flex">
            <button type="button" aria-pressed={view === "cards"} onClick={() => chooseView("cards")} className={segment(view === "cards")}>
              Cards
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => chooseView("list")} className={`${segment(view === "list")} -ml-px`}>
              List
            </button>
          </div>
        </div>
      </div>

      {view === "cards" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {shown.map((c) => {
            const series = seriesOf(c);
            const isPinned = pins.has(c.name);
            return (
              <div key={c.name} className="relative border border-steel/20 bg-surface/40">
                <button
                  type="button"
                  aria-expanded={open === c.name}
                  onClick={() => setOpen(open === c.name ? null : c.name)}
                  className={`block w-full text-left p-3 min-h-[116px] ${open === c.name ? "bg-surface" : "hover:bg-surface/60"}`}
                >
                  <span className="block font-body text-sm text-chalk pr-8 line-clamp-2 min-h-[2.5rem]">{c.name}</span>
                  {c.bestE1rm != null ? (
                    <span className="block font-display text-2xl text-rust mt-1">
                      {Math.round(c.bestE1rm)} <span className="font-body text-xs text-steel">lbs</span>
                    </span>
                  ) : (
                    <span className="block font-body text-xs text-steel mt-2">{c.sessions === 0 ? "Nothing logged yet" : "No estimate yet"}</span>
                  )}
                  {hasGraph(series) ? <Sparkline points={series} /> : null}
                </button>
                {canPin && (
                  <button
                    type="button"
                    aria-pressed={isPinned}
                    aria-label={isPinned ? `Unpin ${c.name}` : `Pin ${c.name} to the front`}
                    onClick={() => void togglePin(c.name)}
                    className={`absolute top-0 right-0 min-h-11 min-w-11 inline-flex items-center justify-center ${isPinned ? "text-rust" : "text-steel hover:text-chalk"}`}
                  >
                    <PinIcon filled={isPinned} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y divide-steel/15">
          {shown.map((c) => {
            const isPinned = pins.has(c.name);
            return (
              <li key={c.name} className="flex items-center justify-between">
                <button type="button" aria-expanded={open === c.name} onClick={() => setOpen(open === c.name ? null : c.name)} className="flex-1 flex items-center justify-between py-2 min-h-11 text-left">
                  <span className="font-body text-sm">{c.name}</span>
                  <span className="font-body text-sm text-rust font-medium">{c.bestE1rm != null ? `${Math.round(c.bestE1rm)} lbs` : "–"}</span>
                </button>
                {canPin && (
                  <button
                    type="button"
                    aria-pressed={isPinned}
                    aria-label={isPinned ? `Unpin ${c.name}` : `Pin ${c.name} to the front`}
                    onClick={() => void togglePin(c.name)}
                    className={`min-h-11 min-w-11 inline-flex items-center justify-center ${isPinned ? "text-rust" : "text-steel hover:text-chalk"}`}
                  >
                    <PinIcon filled={isPinned} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {cards.length > visible && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 min-h-11 font-body text-sm text-rust underline underline-offset-2">
          {showAll ? "Show fewer" : `Show all (${Math.min(cards.length, MAX_SHOWN_ALL)})`}
        </button>
      )}

      {expanded && (
        <div className="mt-3 border border-steel/20 p-4" role="region" aria-label={`${expanded.name} chart`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-body text-sm text-chalk">{expanded.name}</p>
              <p className="font-body text-xs text-steel mt-0.5">
                {expanded.sessions} workout{expanded.sessions === 1 ? "" : "s"}
                {expanded.bestWeight != null ? ` · best ${Math.round(expanded.bestWeight)} lbs` : ""}
                {expanded.bestE1rm != null ? ` · estimated max ${Math.round(expanded.bestE1rm)} lbs` : ""}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(null)} className="min-h-11 px-2 font-body text-xs text-steel underline underline-offset-2">
              Close
            </button>
          </div>
          <TrendChart
            points={seriesOf(expanded)}
            unit=" lbs"
            emptyLabel={expanded.sessions === 0 ? "Nothing logged for this exercise yet." : "Only logged once so far. A second workout will draw the chart."}
          />
          <p className="font-body text-xs text-steel">{metric === "weight" ? "Heaviest weight each day." : "Total weight lifted (weight times reps) each day."}</p>
        </div>
      )}

      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
