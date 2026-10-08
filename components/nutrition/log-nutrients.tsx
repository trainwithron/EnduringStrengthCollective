"use client";

import { useMemo, useState } from "react";
import { NutrientDetailSheet } from "@/components/nutrition/nutrient-detail-sheet";
import { dayTotals, type DayTotals, type LoggedEntry } from "@/lib/nutrient-day";
import { buildOverviewFromDays, GAP_WINDOW_DAYS, NUTRIENT_KEYS, type NutrientRow, type PlanEstimate } from "@/lib/nutrient-view";
import { focusRows, groupRows } from "@/lib/nutrient-focus";
import { gapMessageForCoach } from "@/lib/nutrient-gaps";
import { formatNutrientAmount } from "@/lib/nutrient-panel";
import type { Sex } from "@/lib/dri-data";

// Vitamins and minerals, WITH the food log: a short list of the nutrients that matter today, right under the day's calories and macros, updating the moment a food is logged (the page
// sends the past days once; today is added up here from the entries as they change). Compact by default, every nutrient one tap away, grouped; tapping one opens its detail over the log.
// Calm on purpose: no red for "low", no countdown, a nutrient a logged food does not report is "not reported" and never zero. Nothing here is sent to the AI.
export function LogNutrients({
  groupId,
  athleteId,
  todayKey,
  pastDays,
  age,
  sex,
  entries,
  audience,
  clientName,
  planEstimate,
  partialLog = false,
}: {
  groupId: string;
  athleteId: string;
  todayKey: string;
  // The 29 days before today, added up on the server (oldest first).
  pastDays: DayTotals[];
  age: number | null;
  sex: Sex | null;
  // Today's entries as they stand now.
  entries: LoggedEntry[];
  audience: "client" | "coach";
  clientName?: string;
  // Today's planned meals added up from their ingredients; used (clearly labelled) only when none of today's logged foods has vitamin and mineral detail.
  planEstimate?: PlanEstimate | null;
  // True when the past days were read from a log longer than can be read at once.
  partialLog?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<{ key: string; label: string } | null>(null);
  const o = useMemo(
    () => buildOverviewFromDays({ days30: [...pastDays, dayTotals(todayKey, entries, NUTRIENT_KEYS)], todayEntries: entries, todayKey, age, sex, plan: planEstimate }),
    [pastDays, entries, todayKey, age, sex, planEstimate]
  );
  const who = audience === "coach" ? clientName ?? "this client" : "you";
  const focus = focusRows(o);
  const groups = groupRows(o);
  const nothingYet = o.todayEntries === 0 && o.source !== "plan";

  return (
    <section className="border border-steel/20 p-3" aria-label="Vitamins and minerals today" data-testid="log-nutrients">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <h3 className="font-body text-xs text-steel uppercase tracking-wide">Vitamins and minerals today</h3>
        {!nothingYet && (
          <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="font-body text-xs text-chalk underline underline-offset-2 min-h-[44px] -my-3 px-1">
            {showAll ? "Show fewer" : `Show all ${o.rows.length}`}
          </button>
        )}
      </div>

      {nothingYet ? (
        <p className="font-body text-sm text-steel" data-testid="nutrients-empty">
          {audience === "coach" ? `${clientName ?? "This client"} hasn't logged any food today.` : "Log a food and its vitamins and minerals show up here, with no extra step."}
        </p>
      ) : (
        <>
          {o.source === "plan" ? (
            <p className="font-body text-xs text-amber-400 border-l-2 border-amber-400/60 pl-2 mb-2" data-testid="plan-estimate-note">
              An ESTIMATE from today&apos;s meal plan, not from food {audience === "coach" ? "logged" : "you logged"}.
              {o.planCoverage && o.planCoverage.total > 0 ? ` ${o.planCoverage.covered} of ${o.planCoverage.total} planned ingredients matched nutrition data, so it may be partial.` : ""}
            </p>
          ) : (
            <p className="font-body text-xs text-steel mb-2" data-testid="detail-share">
              {o.detail.detailed} of {o.detail.total} {o.detail.total === 1 ? "food" : "foods"} logged today {o.detail.detailed === 1 ? "has" : "have"} vitamin and mineral detail
              {o.detail.detailed < o.detail.total ? " (foods from search or a label do; a quick calorie entry or a photo estimate does not)" : ""}.
            </p>
          )}

          {!showAll ? (
            <ul className="divide-y divide-steel/15" data-testid="nutrient-focus">
              {focus.map((r) => (
                <NutrientButtonRow key={r.nutrient.key} row={r} fromPlan={o.source === "plan"} audience={audience} who={who} onOpen={() => setOpen({ key: r.nutrient.key, label: r.nutrient.label })} />
              ))}
            </ul>
          ) : (
            <div className="space-y-3" data-testid="nutrient-all">
              {groups.map((g) => (
                <div key={g.key}>
                  <h4 className="font-body text-xs text-steel uppercase tracking-wide mb-0.5">{g.label}</h4>
                  <ul className="divide-y divide-steel/15">
                    {g.rows.map((r) => (
                      <NutrientButtonRow key={r.nutrient.key} row={r} fromPlan={o.source === "plan"} audience={audience} who={who} onOpen={() => setOpen({ key: r.nutrient.key, label: r.nutrient.label })} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {partialLog && <p className="font-body text-xs text-amber-400 border-l-2 border-amber-400/60 pl-2 mt-3" data-testid="partial-log">The earlier days are based on part of the log: it is longer than we can read at once.</p>}
          {o.assumption && <p className="font-body text-xs text-amber-400 border-l-2 border-amber-400/60 pl-2 mt-3">{o.assumption}</p>}
          {o.skippedNote && audience === "client" && <p className="font-body text-xs text-steel mt-2">{o.skippedNote}</p>}
          {o.skippedNote && audience === "coach" && <p className="font-body text-xs text-steel mt-2">{"We don't say a nutrient looks low where men's and women's (or age groups') targets differ until the client's sex and date of birth are filled in (About you)."}</p>}
          <p className="font-body text-xs text-steel mt-2">A nutrient a food does not report shows as &ldquo;not reported&rdquo;, never as zero. General nutrition information, not medical advice.</p>
        </>
      )}

      {open && <NutrientDetailSheet groupId={groupId} athleteId={athleteId} audience={audience} nutrientKey={open.key} label={open.label} onClose={() => setOpen(null)} />}
    </section>
  );
}

function NutrientButtonRow({ row, fromPlan, audience, who, onOpen }: { row: NutrientRow; fromPlan: boolean; audience: "client" | "coach"; who: string; onOpen: () => void }) {
  const { nutrient: n, ref, total, pct, coveragePct } = row;
  const reported = total != null;
  const isGap = row.summary.status === "gap";
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`${n.label}: details`} className="w-full text-left min-h-[44px] py-2 px-1 hover:bg-steel/5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-body text-sm text-chalk">
            {n.label}
            {isGap && <span className="ml-2 font-body text-xs text-amber-400">Worth a look</span>}
          </span>
          <span className="font-body text-sm [font-variant-numeric:tabular-nums] text-chalk">{reported ? `${formatNutrientAmount(total)} ${n.unit}` : <span className="text-steel">Not reported</span>}</span>
        </div>
        {n.role === "target" && ref?.target != null && (
          <>
            {reported && (
              <div className="h-1.5 bg-steel/15 mt-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct ?? 0)} aria-label={`${n.label} today as a percent of the reference intake`}>
                <div className="h-full bg-moss" style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
              </div>
            )}
            <p className="font-body text-xs text-steel mt-1 [font-variant-numeric:tabular-nums]">
              {reported ? `${pct}% of ` : "Reference: "}
              {formatNutrientAmount(ref.target)} {n.unit} {ref.kind ? `(${ref.kind})` : ""}
              {reported && (fromPlan || coveragePct < 99.5) ? ` · ${fromPlan ? "estimated from the meal plan" : `counted from foods making up about ${Math.round(coveragePct)}% of today's calories`}` : ""}
            </p>
          </>
        )}
        {n.role === "limit" && ref?.ul != null && reported && (
          <p className="font-body text-xs text-steel mt-1 [font-variant-numeric:tabular-nums]">
            For information: the level health authorities suggest staying under is {formatNutrientAmount(ref.ul)} {n.unit} a day
          </p>
        )}
        {isGap && (
          <p className="font-body text-xs text-steel mt-1 max-w-[60ch]">
            {audience === "coach"
              ? gapMessageForCoach(n.label, who, GAP_WINDOW_DAYS)
              : `${n.label} has looked on the low side on most of the days we can count lately. It only reflects the foods you logged that report it. Tap for details and foods that could help.`}
          </p>
        )}
      </button>
    </li>
  );
}
