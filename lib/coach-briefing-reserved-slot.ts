// AI Assistant Slice 2 — the reserved-quiet-slot design requirement
// (ai_assistant_opus_deep_dive_findings.md, "The real structural failure
// mode — the opposite of alert fatigue"): the athletes who generate the
// richest cross-signals are the MOST engaged ones, so a purely
// model-driven pick would systematically never mention the quietest,
// most-at-risk client. Enforced here in code — a guarantee, not a prompt
// instruction the model might ignore.

export interface BriefingItem {
  itemType: "observation" | "reflective_question" | "celebration";
  headline: string;
  signalIds: string[];
}

export interface ReservedSlotCandidate {
  id: string;
  description: string;
  isStrongQuietTier: boolean;
}

export function enforceReservedQuietSlot(
  chosen: BriefingItem[],
  candidates: ReservedSlotCandidate[],
  maxItems: number
): BriefingItem[] {
  const strongQuietCandidate = candidates.find((c) => c.isStrongQuietTier);
  if (!strongQuietCandidate) return chosen;

  const alreadyIncluded = chosen.some((item) => item.signalIds.includes(strongQuietCandidate.id));
  if (alreadyIncluded) return chosen;

  const reservedItem: BriefingItem = {
    itemType: "observation",
    headline: strongQuietCandidate.description,
    signalIds: [strongQuietCandidate.id],
  };

  if (chosen.length < maxItems) return [...chosen, reservedItem];
  return [...chosen.slice(0, maxItems - 1), reservedItem];
}
