import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadShareIdentity } from "@/lib/share-identity";
import { getDirectComparison, getBonusAnimalLine } from "@/lib/transformation-joke-bank";

// Transformation Cards — the public celebration surface. Same "public
// page, one service-role read scoped to this exact id, no anon RLS
// grant" pattern as the Milestone Celebrations cards. Deliberately never
// surfaces either absolute weight (starting or current) on the public
// page — only the total change and the joke framing, the same privacy
// restraint already applied throughout this app's other trend-based
// share cards, and arguably more important here given how much more
// personal a literal body weight is than a workout PR.
export async function getSharedTransformationCard(cardId: string) {
  const supabase = createServiceRoleClient();

  const { data: card } = await supabase
    .from("transformation_cards")
    .select(
      "id, athlete_id, group_id, starting_weight, current_weight, window_start_date, window_end_date, humor_enabled, before_photo_id, after_photo_id, milestone_id, created_at"
    )
    .eq("id", cardId)
    .maybeSingle();

  if (!card) return null;

  // The name a stranger sees follows the client's own setting and the under-18 default; a one-on-one space shows the business name; nothing is shown for a client under 18.
  const identity = await loadShareIdentity(supabase, card.athlete_id, card.group_id);
  if (identity.isMinor) return null;

  const totalLossLbs = Math.round((card.starting_weight - card.current_weight) * 10) / 10;
  const seed = card.milestone_id ?? card.id;

  let beforePhotoUrl: string | null = null;
  let afterPhotoUrl: string | null = null;
  // A photo is only ever signed when it is THIS athlete's own (a card could name someone else's photo id).
  if (card.before_photo_id) {
    const { data: photo } = await supabase
      .from("progress_photos")
      .select("storage_path")
      .eq("id", card.before_photo_id)
      .eq("athlete_id", card.athlete_id)
      .maybeSingle();
    if (photo) {
      const { data: signed } = await supabase.storage
        .from("progress-photos")
        .createSignedUrl(photo.storage_path, 3600);
      beforePhotoUrl = signed?.signedUrl ?? null;
    }
  }
  if (card.after_photo_id) {
    const { data: photo } = await supabase
      .from("progress_photos")
      .select("storage_path")
      .eq("id", card.after_photo_id)
      .eq("athlete_id", card.athlete_id)
      .maybeSingle();
    if (photo) {
      const { data: signed } = await supabase.storage
        .from("progress-photos")
        .createSignedUrl(photo.storage_path, 3600);
      afterPhotoUrl = signed?.signedUrl ?? null;
    }
  }

  return {
    id: card.id,
    athleteName: identity.athleteName,
    groupName: identity.groupName,
    totalLossLbs,
    windowStartDate: card.window_start_date as string,
    windowEndDate: card.window_end_date as string,
    directComparison: card.humor_enabled ? getDirectComparison(totalLossLbs, seed) : null,
    bonusLine: card.humor_enabled ? getBonusAnimalLine(totalLossLbs, seed) : null,
    beforePhotoUrl,
    afterPhotoUrl,
    createdAt: card.created_at as string,
  };
}

export type SharedTransformationCard = NonNullable<Awaited<ReturnType<typeof getSharedTransformationCard>>>;
