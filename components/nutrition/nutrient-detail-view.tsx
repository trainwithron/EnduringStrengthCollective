import { DayBars } from "@/components/nutrition/day-bars";
import { GAP_WINDOW_DAYS, type Detail } from "@/lib/nutrient-view";
import { formatNutrientAmount } from "@/lib/nutrient-panel";
import { gapMessage, gapMessageForCoach, NOT_ENOUGH_DATA_LINE } from "@/lib/nutrient-gaps";
import { DRI_PREGNANCY_NOTE, KIND_LABEL } from "@/lib/dri";

// One nutrient in depth: the reference, today, the last 7 and 30 days as a percent of the reference intake, which foods it came from, and everyday foods that could help (checked against
// the person's allergies and food rules). Read-only. The body is shared by the nutrient's own page and the panel that opens over the food log, so the two always say the same thing.
// No hooks and no browser-only code, so it renders on the server or in the browser. Nothing here is sent to the AI.
export interface NutrientDetailFacts {
  detail: Detail;
  audience: "client" | "coach";
  // "you" for the client, the client's name for the coach.
  who: string;
  // How many foods were logged today, and the "reported by..." line for today (null when nothing was logged).
  todayEntries: number;
  completeness: string | null;
  // True when the log was longer than could be read at once.
  truncated: boolean;
}

export function NutrientDetailView({ facts }: { facts: NutrientDetailFacts }) {
  const { detail: d, audience, who, todayEntries, completeness, truncated } = facts;
  const n = d.nutrient;
  const counted7 = d.last7.filter((b) => b.counts).length;
  const counted30 = d.last30.filter((b) => b.counts).length;
  return (
    <div className="space-y-6 max-w-[760px]">
      {truncated && (
        <p className="font-body text-xs text-amber-400 border-l-2 border-amber-400/60 pl-2" data-testid="partial-log">
          These figures are based on part of the log: it is longer than we can read at once, so the newest days or some entries may be missing.
        </p>
      )}

      <section className="border border-steel/20 p-4 space-y-2" aria-label="Reference intake">
        <h2 className="font-display uppercase text-xs tracking-wide text-steel">Reference</h2>
        {n.role === "target" && d.ref?.target != null ? (
          <p className="font-body text-sm text-chalk [font-variant-numeric:tabular-nums]">
            {formatNutrientAmount(d.ref.target)} {n.unit} a day <span className="text-steel">· {d.ref.kind ? KIND_LABEL[d.ref.kind] : ""} · {d.ref.groupLabel}</span>
          </p>
        ) : n.role === "limit" && d.ref?.ul != null ? (
          <p className="font-body text-sm text-chalk [font-variant-numeric:tabular-nums]">
            For information: {formatNutrientAmount(d.ref.ul)} {n.unit} a day is the level health authorities suggest staying under <span className="text-steel">· {d.ref.groupLabel}</span>
          </p>
        ) : n.role === "info" ? (
          <p className="font-body text-sm text-steel">There is no daily target for this. Health authorities suggest keeping it low as part of a balanced diet; it is shown as an amount only.</p>
        ) : (
          <p className="font-body text-sm text-steel">We don&apos;t have a reference amount for {who} (the table covers ages 1 to 120), so only amounts are shown.</p>
        )}
        {d.assumption && <p className="font-body text-xs text-amber-400 border-l-2 border-amber-400/60 pl-2">{d.assumption}</p>}
        {d.ref?.ul != null && n.role === "target" && (
          <p className="font-body text-xs text-steel">
            Upper limit, for information only: {formatNutrientAmount(d.ref.ul)} {n.key === "folate_mcg" ? "mcg of folic acid" : n.unit} a day ({d.ref.ulScope}). It is not a target and not a reason to change anything on its own.
          </p>
        )}
        {d.ref?.note && <p className="font-body text-xs text-steel">{d.ref.note}</p>}
        {n.dataNote && <p className="font-body text-xs text-steel">{n.dataNote}</p>}
      </section>

      <section aria-label="Today">
        <h2 className="font-display uppercase text-xs tracking-wide text-steel mb-2">Today</h2>
        {todayEntries === 0 ? (
          <p className="font-body text-sm text-steel">{audience === "coach" ? "No food logged today." : "No food logged today yet."}</p>
        ) : d.today.total == null ? (
          <p className="font-body text-sm text-chalk">
            Not reported. <span className="text-steel">{completeness}</span>
          </p>
        ) : (
          <p className="font-body text-sm text-chalk [font-variant-numeric:tabular-nums]">
            {formatNutrientAmount(d.today.total)} {n.unit}
            {d.today.pct != null ? <span className="text-steel"> · {d.today.pct}% of the reference</span> : null}
            <span className="block text-xs text-steel mt-0.5">{completeness}</span>
          </p>
        )}
      </section>

      {n.role === "target" && d.target != null && (
        <>
          <section aria-label="Last 7 days">
            <h2 className="font-display uppercase text-xs tracking-wide text-steel mb-2">Last 7 days</h2>
            <DayBars bars={d.last7} label={`${n.label}, last 7 days, as a percent of the reference intake`} />
            <p className="font-body text-xs text-steel mt-2">
              {d.avg7 != null ? `On the ${counted7} ${counted7 === 1 ? "day" : "days"} that count, about ${d.avg7}% of the reference on average.` : "No day in this week had enough logged and reported to count."} Light dashed bars are days that
              don&apos;t count (too little food logged, or too little of it reports this nutrient); a thin grey line is a day with nothing reported.
            </p>
          </section>
          <section aria-label="Last 30 days">
            <h2 className="font-display uppercase text-xs tracking-wide text-steel mb-2">Last 30 days</h2>
            <DayBars bars={d.last30} label={`${n.label}, last 30 days, as a percent of the reference intake`} compact />
            <p className="font-body text-xs text-steel mt-2">{d.avg30 != null ? `On the ${counted30} ${counted30 === 1 ? "day" : "days"} that count, about ${d.avg30}% of the reference on average.` : "No day in this month had enough logged and reported to count."}</p>
          </section>
          <section aria-label="What stands out">
            {d.summary.status === "gap" ? (
              <p className="font-body text-sm text-chalk border border-steel/20 p-4 max-w-[70ch]">{audience === "coach" ? gapMessageForCoach(n.label, who, GAP_WINDOW_DAYS) : gapMessage(n.label, GAP_WINDOW_DAYS)}</p>
            ) : d.summary.status === "ok" ? (
              <p className="font-body text-sm text-steel">Nothing stands out: on the days that count over the last {GAP_WINDOW_DAYS} days, {n.label.toLowerCase()} is not running low.</p>
            ) : d.gapSkipped ? (
              <p className="font-body text-sm text-steel">
                We don&apos;t say whether this is running low until {audience === "coach" ? "the client's" : "your"} {d.ref?.assumedSex ? "sex" : "date of birth"} is filled in, because the target is different for different people
                {audience === "coach" ? "" : ". You can add it in About you"}.
              </p>
            ) : (
              <p className="font-body text-sm text-steel">{NOT_ENOUGH_DATA_LINE}</p>
            )}
          </section>
        </>
      )}

      <section aria-label="Where it came from">
        <h2 className="font-display uppercase text-xs tracking-wide text-steel mb-2">Where it came from (last 30 days)</h2>
        {d.sources.length === 0 ? (
          <p className="font-body text-sm text-steel">No food logged in the last 30 days reports this nutrient.</p>
        ) : (
          <ul className="border border-steel/20 divide-y divide-steel/15">
            {d.sources.map((s) => (
              <li key={s.name} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span className="font-body text-sm text-chalk">{s.name}</span>
                <span className="font-body text-xs text-steel [font-variant-numeric:tabular-nums]">
                  {formatNutrientAmount(s.amount)} {n.unit} · {s.sharePct}%
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="font-body text-xs text-steel mt-1">Shares are of the amount that was reported, not of everything eaten.</p>
      </section>

      {n.goodSources.length > 0 && (
        <section aria-label="Foods that could help">
          <h2 className="font-display uppercase text-xs tracking-wide text-steel mb-2">Everyday foods rich in {n.label.toLowerCase()}</h2>
          {d.ideas.hiddenReason === "no-rules" ? (
            <p className="font-body text-sm text-steel">We couldn&apos;t read {audience === "coach" ? "the client's" : "your"} food preferences just now, so no foods are suggested.</p>
          ) : d.ideas.hiddenReason === "diet" ? (
            <p className="font-body text-sm text-steel">{audience === "coach" ? "These lists aren't written for this way of eating." : "Ask your coach for ideas that fit the way you eat."}</p>
          ) : d.ideas.foods.length === 0 ? (
            <p className="font-body text-sm text-steel">None of our usual examples fit {audience === "coach" ? "the client's" : "your"} allergies and food rules.</p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-2">
                {d.ideas.foods.map((f) => (
                  <li key={f} className="font-body text-sm text-chalk border border-steel/25 px-3 py-1.5">
                    {f}
                  </li>
                ))}
              </ul>
              <p className="font-body text-xs text-steel mt-2">Ideas that avoid {audience === "coach" ? "the client's" : "your"} allergies and food rules. Always check labels; this is not a meal plan.</p>
            </>
          )}
        </section>
      )}

      <p className="font-body text-xs text-steel max-w-[70ch] border-t border-steel/15 pt-4">
        General nutrition information, not medical advice. If you are concerned about {audience === "coach" ? "a client's" : "your"} intake, talk with {audience === "coach" ? "them and, if needed, a clinician" : "your coach or a clinician"}.{" "}
        {DRI_PREGNANCY_NOTE}{" "}
        {d.ref && (
          <>
            Source:{" "}
            <a href={d.ref.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {d.ref.source}
            </a>
            .
          </>
        )}
      </p>
    </div>
  );
}
