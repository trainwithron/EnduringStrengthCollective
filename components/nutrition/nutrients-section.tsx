import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { HEADLINE_KEYS } from "@/lib/nutrient-catalog";
import { buildOverview, completenessLine, GAP_WINDOW_DAYS, type NutrientRow, type Overview, type PlanEstimate } from "@/lib/nutrient-view";
import { fetchAgeAndSex, fetchNutrientLog } from "@/lib/nutrient-data";
import { formatNutrientAmount } from "@/lib/nutrient-panel";
import { gapMessage, gapMessageForCoach } from "@/lib/nutrient-gaps";
import { DRI_PREGNANCY_NOTE, KIND_LABEL } from "@/lib/dri";

// The Nutrients section of a client's Nutrition area: today's vitamins and minerals against the person's reference intake, the few that have been on the low side lately, and a way
// into each nutrient. Used on the client's own page and (with coach wording) in the coach's view of the same client. Server-fed; nothing here is sent to the AI.
//
// Three promises, kept everywhere: a nutrient a food does not report is "not reported" and never zero; every figure says how much of the day it covers; and a reference figure that
// rests on an assumption (age or sex not filled in) says so.

export async function NutrientsSection({
  athleteId,
  todayKey,
  audience,
  clientName,
  detailHref,
  planEstimate,
}: {
  athleteId: string;
  todayKey: string;
  audience: "client" | "coach";
  clientName?: string;
  // Builds the link to one nutrient's page.
  detailHref: (key: string) => string;
  // Today's planned meals added up from their ingredients, used (clearly labelled) only when none of today's logged foods has vitamin and mineral detail.
  planEstimate?: PlanEstimate | null;
}) {
  const supabase = await createServerClient();
  const [{ entries, truncated }, { age, sex }] = await Promise.all([fetchNutrientLog(supabase, athleteId, todayKey), fetchAgeAndSex(supabase, athleteId, todayKey)]);
  const o = buildOverview({ entries, todayKey, age, sex, plan: planEstimate });
  return <NutrientsView overview={o} audience={audience} clientName={clientName} detailHref={detailHref} partialLog={truncated} />;
}

// The markup, separate from the reading so it can be rendered and tested on its own.
export function NutrientsView({ overview: o, audience, clientName, detailHref, partialLog = false }: { overview: Overview; audience: "client" | "coach"; clientName?: string; detailHref: (key: string) => string; partialLog?: boolean }) {
  const who = audience === "coach" ? clientName ?? "this client" : "you";
  const headline = new Set<string>(HEADLINE_KEYS);
  const shown = o.rows.filter((r) => r.nutrient.role === "target" && (headline.has(r.nutrient.key) || r.seenRecently));
  const hidden = o.rows.filter((r) => r.nutrient.role === "target" && !headline.has(r.nutrient.key) && !r.seenRecently);
  const info = o.rows.filter((r) => r.nutrient.role !== "target" && r.seenRecently);

  return (
    <div className="space-y-4" data-testid="nutrients-section">
      <p className="font-body text-xs text-steel max-w-[70ch]">
        {audience === "coach" ? "Built from the foods " + who + " logged that report each nutrient" : "Built from the foods you logged that report each nutrient"}. A nutrient a food does not report shows as
        &ldquo;not reported&rdquo;, never as zero, so a low figure can just mean less of the day was counted.
      </p>

      {o.source === "plan" ? (
        <p className="font-body text-xs text-amber-400 border-l-2 border-amber-400/60 pl-2 max-w-[70ch]" data-testid="plan-estimate-note">
          These figures are an ESTIMATE from today&apos;s meal plan, not from food {audience === "coach" ? "logged" : "you logged"}.
          {o.planCoverage && o.planCoverage.total > 0 ? ` ${o.planCoverage.covered} of ${o.planCoverage.total} planned ingredients could be matched to nutrition data, so the totals may be partial.` : ""} Once {audience === "coach" ? "they log" : "you log"} foods with vitamin and mineral detail, this shows what was actually eaten.
        </p>
      ) : o.todayEntries === 0 ? (
        <p className="font-body text-sm text-steel border border-steel/20 p-4">{audience === "coach" ? `${who} hasn't logged any food today.` : "Log some food today and your vitamins and minerals will show up here."}</p>
      ) : (
        <p className="font-body text-xs text-steel" data-testid="detail-share">
          {o.detail.detailed} of {o.detail.total} {o.detail.total === 1 ? "food" : "foods"} logged today {o.detail.detailed === 1 ? "has" : "have"} vitamin and mineral detail.
          {o.detail.detailed < o.detail.total ? " Foods searched in the food search, or added with their label, carry it; a quick calorie entry or a photo estimate does not." : ""}
        </p>
      )}

      {partialLog && <p className="font-body text-xs text-amber-400 border-l-2 border-amber-400/60 pl-2 max-w-[70ch]" data-testid="partial-log">These figures are based on part of the log: it is longer than we can read at once.</p>}
      {o.assumption && <p className="font-body text-xs text-amber-400 border-l-2 border-amber-400/60 pl-2 max-w-[70ch]">{o.assumption}</p>}
      {o.skippedNote && audience === "client" && <p className="font-body text-xs text-steel max-w-[70ch]" data-testid="gaps-skipped">{o.skippedNote}</p>}
      {o.skippedNote && audience === "coach" && <p className="font-body text-xs text-steel max-w-[70ch]" data-testid="gaps-skipped">{"We don't say a nutrient looks low where men's and women's (or age groups') targets differ until the client's sex and date of birth are filled in (About you)."}</p>}

      {o.gaps.length > 0 && (
        <section className="border border-steel/20 p-4" aria-label="Worth a look">
          <h3 className="font-display uppercase text-xs tracking-wide text-steel mb-2">Worth a look</h3>
          <ul className="space-y-2">
            {o.gaps.map((g) => (
              <li key={g.nutrient.key}>
                <Link href={detailHref(g.nutrient.key)} className="font-body text-sm text-chalk underline underline-offset-2">
                  {g.nutrient.label}
                </Link>
                <p className="font-body text-xs text-steel max-w-[70ch]">{audience === "coach" ? gapMessageForCoach(g.nutrient.label, who, GAP_WINDOW_DAYS) : gapMessage(g.nutrient.label, GAP_WINDOW_DAYS)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="border border-steel/20 divide-y divide-steel/15">
        {shown.map((r) => (
          <NutrientListRow key={r.nutrient.key} row={r} href={detailHref(r.nutrient.key)} fromPlan={o.source === "plan"} />
        ))}
        {info.map((r) => (
          <NutrientListRow key={r.nutrient.key} row={r} href={detailHref(r.nutrient.key)} fromPlan={o.source === "plan"} />
        ))}
      </ul>

      {hidden.length > 0 && (
        <details className="border border-steel/20">
          <summary className="min-h-[44px] flex items-center px-3 font-body text-xs text-steel cursor-pointer">Other vitamins and minerals ({hidden.length}) with no logged data yet</summary>
          <ul className="divide-y divide-steel/15">
            {hidden.map((r) => (
              <NutrientListRow key={r.nutrient.key} row={r} href={detailHref(r.nutrient.key)} fromPlan={o.source === "plan"} />
            ))}
          </ul>
        </details>
      )}

      <p className="font-body text-xs text-steel max-w-[70ch]">
        Reference amounts are the Recommended Dietary Allowance (RDA) or Adequate Intake (AI) from the National Academies&apos; Dietary Reference Intakes for {audience === "coach" ? "the client's" : "your"} age and
        sex. Upper limits are shown for information only. {DRI_PREGNANCY_NOTE}
      </p>
    </div>
  );
}

function NutrientListRow({ row, href, fromPlan = false }: { row: NutrientRow; href: string; fromPlan?: boolean }) {
  const { nutrient: n, ref, total, pct, coveragePct } = row;
  const reported = total != null;
  const kind = ref?.kind ? KIND_LABEL[ref.kind] : null;
  return (
    <li>
      <Link href={href} className="block min-h-[44px] px-3 py-2.5 hover:bg-steel/5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-body text-sm text-chalk">{n.label}</span>
          <span className="font-body text-sm [font-variant-numeric:tabular-nums] text-chalk">{reported ? `${formatNutrientAmount(total)} ${n.unit}` : <span className="text-steel">Not reported</span>}</span>
        </div>
        {n.role === "target" && ref?.target != null && (
          <>
            <div className="h-1.5 bg-steel/15 mt-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct ?? 0)} aria-label={`${n.label} today as a percent of the reference intake`}>
              <div className="h-full bg-rust" style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
            </div>
            <p className="font-body text-xs text-steel mt-1 [font-variant-numeric:tabular-nums]">
              {reported ? `${pct}% of ` : "Reference: "}
              {formatNutrientAmount(ref.target)} {n.unit} {kind ? `(${ref.kind})` : ""}
              {reported && (fromPlan || coveragePct < 99.5) ? ` · ${fromPlan ? `estimated from the meal plan, about ${Math.round(coveragePct)}% of its ingredients matched` : `counted from foods making up about ${Math.round(coveragePct)}% of today's calories`}` : ""}
            </p>
          </>
        )}
        {n.role === "limit" && ref?.ul != null && reported && (
          <p className="font-body text-xs text-steel mt-1 [font-variant-numeric:tabular-nums]">
            For information: the level health authorities suggest staying under is {formatNutrientAmount(ref.ul)} {n.unit} a day
            {fromPlan ? " · estimated from the meal plan" : coveragePct < 99.5 ? ` · counted from foods making up about ${Math.round(coveragePct)}% of today's calories` : ""}
          </p>
        )}
      </Link>
    </li>
  );
}

export { completenessLine };
