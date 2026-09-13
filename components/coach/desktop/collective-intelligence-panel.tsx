import Link from "next/link";

export interface CollectiveIntelligenceItem {
  id: string;
  itemType: "observation" | "reflective_question" | "celebration";
  headline: string;
  athleteId: string;
  groupId: string;
}

// "Collective Intelligence" (locked user-facing name — see
// ai_assistant_marketing_deep_dive.md) — today's synthesized briefing,
// generated once daily by app/api/cron/coach-briefing/route.ts. The word
// "Spotter" (the internal name for the individual detectors feeding this)
// deliberately never appears here — backstage-only per that same doc, to
// protect the already-locked 3-items-a-day minimalism from per-item
// label clutter.
export function CollectiveIntelligencePanel({
  items,
  hasRunToday,
}: {
  items: CollectiveIntelligenceItem[];
  // Distinguishes "the cron ran and genuinely found nothing" from "it
  // hasn't run yet today" — an empty day is a real, calm result worth
  // saying plainly, not indistinguishable from the feature being broken.
  hasRunToday: boolean;
}) {
  if (!hasRunToday) return null;

  return (
    <div className="border border-steel/20 bg-surface p-5 mb-6">
      <p className="font-body text-[10px] text-steel uppercase tracking-wide font-bold mb-3">
        Collective Intelligence
      </p>
      {items.length === 0 ? (
        <p className="font-body text-sm text-steel">Nothing worth flagging today — a quiet one.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-2">
              <span
                className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                  item.itemType === "celebration"
                    ? "bg-moss"
                    : item.itemType === "reflective_question"
                    ? "bg-steel"
                    : "bg-rust"
                }`}
              />
              <p className="font-body text-sm text-chalk">
                <Link href={`/groups/${item.groupId}/athletes/${item.athleteId}`} className="text-rust hover:underline">
                  {item.headline}
                </Link>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
