import { createServiceRoleClient } from "@/lib/supabase/service-role";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", card.athlete_id)
    .maybeSingle();
  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", card.group_id)
    .maybeSingle();

  const totalLossLbs = Math.round((card.starting_weight - card.current_weight) * 10) / 10;
  const seed = card.milestone_id ?? card.id;

  let beforePhotoUrl: string | null = null;
  let afterPhotoUrl: string | null = null;
  if (card.before_photo_id) {
    const { data: photo } = await supabase
      .from("progress_photos")
      .select("storage_path")
      .eq("id", card.before_photo_id)
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
    athleteName: profile?.full_name ?? "An athlete",
    groupName: group?.name ?? "The Enduring Strength Collective",
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
